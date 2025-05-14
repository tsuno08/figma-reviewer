type PluginMessage = {
  type: string;
  apiKey?: string;
  figmaToken?: string;
  additionalPrompt?: string;
};

type GeminiResponse = {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
};

const INITIAL_PROMPT =
  "以下のUIデザインをレビューしてください。ユーザビリティ、視覚的な魅力、改善点の可能性についてフィードバックをお願いします。レイアウト、配色、タイポグラフィ、全体的なユーザーエクスペリエンスなどの側面を考慮してください。800文字以内で簡潔に、日本語で回答してください。\n\n回答の形式について：\n- 見出しには '#' を使用可能です\n- 箇条書きには '-' を使用可能です\n- 太字、斜体、コードブロックなどの装飾的な記法の使用は避けてください";
const GEMINI_MODEL_NAME = "gemini-2.0-flash";
const STORAGE_API_KEY = "gemini-api-key";
const STORAGE_FIGMA_TOKEN = "figma-token";

figma.showUI(__html__, { width: 400, height: 400 });

// Gemini APIへのリクエストとリトライ処理
const requestGeminiAPI = async (
  apiKey: string,
  requestBody: any,
  retryCount = 0
): Promise<GeminiResponse | void> => {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (response.status === 503 && retryCount < 3) {
      // 503エラーの場合は少し待ってリトライ
      const waitTime = Math.pow(2, retryCount) * 1000; // 1秒、2秒、4秒と待ち時間を増やす
      figma.notify(
        `サーバーが混雑しています。${waitTime / 1000}秒後に再試行します...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return requestGeminiAPI(apiKey, requestBody, retryCount + 1);
    }

    if (!response.ok) {
      figma.notify(
        `APIリクエストに失敗しました: ${response.status} ${response.statusText}`
      );
      return;
    }

    return (await response.json()) as GeminiResponse;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    figma.notify(`APIリクエストに失敗しました: ${error}`);
    return;
  }
};

figma.ui.onmessage = async (msg: PluginMessage) => {
  switch (msg.type) {
    case "load-api-key":
      const savedApiKey = await figma.clientStorage.getAsync(STORAGE_API_KEY);
      if (savedApiKey) {
        figma.ui.postMessage({ type: "api-key-loaded", apiKey: savedApiKey });
      }
      break;
    case "load-figma-token":
      const savedToken = await figma.clientStorage.getAsync(
        STORAGE_FIGMA_TOKEN
      );
      if (savedToken) {
        figma.ui.postMessage({
          type: "figma-token-loaded",
          figmaToken: savedToken,
        });
      }
      break;
    case "load-gemini-api":
      figma.ui.postMessage({
        type: "load-gemini-api",
      });
      break;
    case "get-review":
      const { apiKey, figmaToken, additionalPrompt } = msg;
      if (!apiKey || !figmaToken) {
        // 保存されたAPIキーを確認
        const savedApiKey = await figma.clientStorage.getAsync(STORAGE_API_KEY);
        const savedToken = await figma.clientStorage.getAsync(
          STORAGE_FIGMA_TOKEN
        );
        if (!savedApiKey || !savedToken) {
          figma.notify(
            !savedApiKey && !savedToken
              ? "APIキーとFigmaトークンが入力されていません。"
              : !savedApiKey
              ? "APIキーが入力されていません。"
              : "Figmaトークンが入力されていません。"
          );
          figma.ui.postMessage({
            type: "finished",
          });
          return;
        }
        msg.apiKey = savedApiKey;
        msg.figmaToken = savedToken;
      } else {
        // 認証情報を保存
        if (apiKey) await figma.clientStorage.setAsync(STORAGE_API_KEY, apiKey);
        if (figmaToken)
          await figma.clientStorage.setAsync(STORAGE_FIGMA_TOKEN, figmaToken);
      }

      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.notify(
          "フレーム、コンポーネント、またはインスタンスを選択してください。"
        );
        figma.ui.postMessage({
          type: "finished",
        });
        return;
      }
      if (selection.length > 1) {
        figma.notify("1つだけ選択してください。");
        figma.ui.postMessage({
          type: "finished",
        });
        return;
      }

      const selectedFrame = selection[0];

      if (
        selectedFrame.type !== "FRAME" &&
        selectedFrame.type !== "COMPONENT" &&
        selectedFrame.type !== "INSTANCE"
      ) {
        figma.notify(
          "フレーム、コンポーネント、またはインスタンスを選択してください。"
        );
        figma.ui.postMessage({
          type: "finished",
        });
        return;
      }

      figma.notify("レビューを取得中...");

      try {
        const exportSettings: ExportSettingsImage = { format: "PNG" };
        const imageBytes = await selectedFrame.exportAsync(exportSettings);

        const imagePart = {
          inlineData: {
            data: figma.base64Encode(imageBytes),
            mimeType: "image/png",
          },
        };

        const fullPrompt = additionalPrompt
          ? `${INITIAL_PROMPT} ${additionalPrompt}`
          : INITIAL_PROMPT;

        const requestBody = {
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: fullPrompt,
                },
                imagePart,
              ],
            },
          ],
        };

        const result = await requestGeminiAPI(msg.apiKey!, requestBody);
        if (
          !result ||
          !result.candidates ||
          result.candidates.length === 0 ||
          !result.candidates[0].content ||
          !result.candidates[0].content.parts ||
          result.candidates[0].content.parts.length === 0
        ) {
          figma.notify("レビューの取得に失敗しました。");
          figma.ui.postMessage({
            type: "finished",
          });
          return;
        }

        const reviewText = result.candidates[0].content.parts[0].text;

        // レビューをコメントとして追加
        figma.notify("レビューを追加しています...");

        const fileKey = figma.fileKey;
        const commentResponse = await fetch(
          `https://api.figma.com/v1/files/${fileKey}/comments`,
          {
            method: "POST",
            headers: {
              "X-FIGMA-TOKEN": msg.figmaToken!, // Non-null assertion operatorを使用
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: reviewText,
              client_meta: {
                node_id: selectedFrame.id,
                node_offset: { x: 0, y: 0 },
              },
              pinned_node: selectedFrame.id,
            }),
          }
        );

        if (!commentResponse.ok) {
          figma.notify(
            `コメントの追加に失敗しました: ${commentResponse.status}`
          );
          figma.ui.postMessage({
            type: "finished",
          });
          return;
        }

        figma.notify("レビューをコメントとして追加しました");
        figma.closePlugin();
      } catch (error) {
        let errorMessage =
          "レビューの取得に失敗しました。APIキーとネットワーク接続を確認してください。";
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        figma.notify(errorMessage);
        figma.ui.postMessage({
          type: "finished",
        });
      }
  }
};
