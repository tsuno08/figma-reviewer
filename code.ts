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

// Constants
const INITIAL_PROMPT =
  "以下のUIデザインをレビューしてください。ユーザビリティ、視覚的な魅力、改善点の可能性についてフィードバックをお願いします。レイアウト、配色、タイポグラフィ、全体的なユーザーエクスペリエンスなどの側面を考慮してください。800文字以内で簡潔に、日本語で回答してください。";
const GEMINI_MODEL_NAME = "gemini-2.0-flash";
const STORAGE_API_KEY = "gemini-api-key";
const STORAGE_FIGMA_TOKEN = "figma-token";

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 300, height: 400 });

// Base64エンコーディングのヘルパー関数
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const base64Chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 3) {
    const chunk =
      (bytes[i] << 16) |
      ((i + 1 < len ? bytes[i + 1] : 0) << 8) |
      (i + 2 < len ? bytes[i + 2] : 0);
    const base64Chunk =
      base64Chars[(chunk >> 18) & 63] +
      base64Chars[(chunk >> 12) & 63] +
      (i + 1 < len ? base64Chars[(chunk >> 6) & 63] : "=") +
      (i + 2 < len ? base64Chars[chunk & 63] : "=");
    binary += base64Chunk;
  }
  return binary;
}

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
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
          data: arrayBufferToBase64(imageBytes),
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

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = (await response.json()) as GeminiResponse;
      const reviewText = result.candidates[0].content.parts[0].text;

      // Figmaのアクセストークンを取得
      const figmaToken = await figma.clientStorage.getAsync(
        STORAGE_FIGMA_TOKEN
      );
      if (!figmaToken) {
        throw new Error("Figmaのアクセストークンが設定されていません。");
      }

      // レビューをコメントとして追加
      figma.notify("レビューを追加しています...");

      const fileKey = figma.fileKey;
      const commentResponse = await fetch(
        `https://api.figma.com/v1/files/${fileKey}/comments`,
        {
          method: "POST",
          headers: {
            "X-FIGMA-TOKEN": figmaToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: reviewText,
            client_meta: {
              node_id: selectedFrame.id,
              node_offset: { x: 0, y: 0 }
            },
            pinned_node: selectedFrame.id
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
