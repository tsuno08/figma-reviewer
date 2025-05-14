// Type definitions
type PluginMessage = {
  type: string;
  apiKey?: string;
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
  "以下のUIデザインをレビューしてください。ユーザビリティ、視覚的な魅力、改善点の可能性についてフィードバックをお願いします。レイアウト、配色、タイポグラフィ、全体的なユーザーエクスペリエンスなどの側面を考慮してください。日本語で回答してください。";
const GEMINI_MODEL_NAME = "gemini-2.0-flash";

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
  if (msg.type === "get-review") {
    const { apiKey, additionalPrompt } = msg;
    if (!apiKey) {
      figma.ui.postMessage({
        type: "error",
        error:
          "APIキーが入力されていません。Gemini APIキーを入力してください。",
      });
      return;
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

      // レビューをコメントとして追加
      figma.notify("レビューを追加しています...");
      selectedFrame.setRelaunchData({ comment: reviewText });
      figma.currentPage.setRelaunchData({ hasComments: "true" });

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
