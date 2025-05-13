import { GoogleGenerativeAI, InlineDataPart } from "@google/generative-ai";

// Type definitions
type PluginMessage = {
  type: string;
  apiKey?: string;
  additionalPrompt?: string;
};

// Constants
const INITIAL_PROMPT =
  "以下のUIデザインをレビューしてください。ユーザビリティ、視覚的な魅力、改善点の可能性についてフィードバックをお願いします。レイアウト、配色、タイポグラフィ、全体的なユーザーエクスペリエンスなどの側面を考慮してください。日本語で回答してください。";
const GEMINI_MODEL_NAME = "gemini-2.0-flash";

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 300, height: 400 });

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

      // Initialize Google Generative AI
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_NAME });

      const imagePart: InlineDataPart = {
        inlineData: {
          data: Buffer.from(imageBytes).toString("base64"),
          mimeType: "image/png",
        },
      };

      const fullPrompt = additionalPrompt
        ? `${INITIAL_PROMPT} ${additionalPrompt}`
        : INITIAL_PROMPT;

      const result = await model.generateContent([fullPrompt, imagePart]);
      const response = result.response;
      const reviewText = response.text();

      figma.ui.postMessage({ type: "review-result", review: reviewText });
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
