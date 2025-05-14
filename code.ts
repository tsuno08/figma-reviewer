// Type definitions
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

figma.showUI(__html__, { width: 300, height: 400 });

function cleanReviewText(text: string): string {
  return text
    .replace(/[`*_~>]/g, "") // 装飾的なMarkdown記法のみを除去（#や-は構造化のために残す）
    .replace(/\n{3,}/g, "\n\n") // 過剰な改行を2行までに制限
    .trim(); // 前後の余分な空白を除去
}

// Gemini APIへのリクエストとリトライ処理
async function requestGeminiAPI(
  apiKey: string,
  requestBody: any,
  retryCount = 0
): Promise<GeminiResponse> {
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
      figma.ui.postMessage({
        type: "loading",
        message: `サーバーが混雑しています。${
          waitTime / 1000
        }秒後に再試行します...`,
      });
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return requestGeminiAPI(apiKey, requestBody, retryCount + 1);
    }

    if (!response.ok) {
      throw new Error("APIリクエストに失敗しました");
    }

    return (await response.json()) as GeminiResponse;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("APIリクエストに失敗しました");
  }
}

figma.ui.onmessage = async (msg: PluginMessage) => {
  if (msg.type === "load-api-key") {
    const savedApiKey = await figma.clientStorage.getAsync(STORAGE_API_KEY);
    if (savedApiKey) {
      figma.ui.postMessage({ type: "api-key-loaded", apiKey: savedApiKey });
    }
  } else if (msg.type === "load-figma-token") {
    const savedToken = await figma.clientStorage.getAsync(STORAGE_FIGMA_TOKEN);
    if (savedToken) {
      figma.ui.postMessage({
        type: "figma-token-loaded",
        figmaToken: savedToken,
      });
    }
  } else if (msg.type === "get-review") {
    const { apiKey, figmaToken, additionalPrompt } = msg;
    if (!apiKey || !figmaToken) {
      // 保存されたAPIキーを確認
      const savedApiKey = await figma.clientStorage.getAsync(STORAGE_API_KEY);
      const savedToken = await figma.clientStorage.getAsync(
        STORAGE_FIGMA_TOKEN
      );
      if (!savedApiKey || !savedToken) {
        figma.ui.postMessage({
          type: "error",
          error:
            !savedApiKey && !savedToken
              ? "APIキーとFigmaトークンが入力されていません。"
              : !savedApiKey
              ? "APIキーが入力されていません。"
              : "Figmaトークンが入力されていません。",
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
      figma.ui.postMessage({
        type: "error",
        error:
          "フレームが選択されていません。レビューするフレーム、コンポーネント、またはインスタンスを選択してください。",
      });
      return;
    }
    if (selection.length > 1) {
      figma.ui.postMessage({
        type: "error",
        error:
          "複数のフレームが選択されています。レビューするフレーム、コンポーネント、またはインスタンスを1つだけ選択してください。",
      });
      return;
    }

    const selectedFrame = selection[0];

    if (
      selectedFrame.type !== "FRAME" &&
      selectedFrame.type !== "COMPONENT" &&
      selectedFrame.type !== "INSTANCE"
    ) {
      figma.ui.postMessage({
        type: "error",
        error:
          "選択が無効です。フレーム、コンポーネント、またはインスタンスを選択してください。",
      });
      return;
    }

    figma.ui.postMessage({
      type: "loading",
      message: "画像をエクスポートし、レビューを取得しています...",
    });

    try {
      // Export the selected frame as an image
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

      // レビューテキストから装飾を削除し、プレーンテキストに変換
      const rawReviewText = result.candidates[0].content.parts[0].text;

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
            message: cleanReviewText(rawReviewText),
            client_meta: {
              node_id: selectedFrame.id,
              node_offset: { x: 0, y: 0 },
            },
            pinned_node: selectedFrame.id,
          }),
        }
      );

      if (!commentResponse.ok) {
        throw new Error(
          `コメントの追加に失敗しました: ${commentResponse.status}`
        );
      }

      figma.notify("レビューをコメントとして追加しました");
      figma.closePlugin();
    } catch (error) {
      console.error("レビュー取得エラー:", error);
      let errorMessage =
        "レビューの取得に失敗しました。APIキーとネットワーク接続を確認してください。";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      figma.ui.postMessage({ type: "error", error: errorMessage });
    }
  }
};
