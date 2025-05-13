import { GoogleGenerativeAI, InlineDataPart } from "@google/generative-ai";

// Type definitions
type PluginMessage = {
  type: string;
  apiKey?: string;
  additionalPrompt?: string;
};

// Constants
const INITIAL_PROMPT =
  "Please review the following UI design. Provide feedback on its usability, visual appeal, and any potential areas for improvement. Consider aspects like layout, color scheme, typography, and overall user experience.";
const GEMINI_MODEL_NAME = "gemini-pro-vision"; // gemini-2.0-flash から gemini-pro-vision に戻しました。必要に応じて変更してください。

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
        error: "API Key is missing. Please enter your Gemini API Key.",
      });
      return;
    }

    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({
        type: "error",
        error:
          "No frame selected. Please select a frame, component, or instance to review.",
      });
      return;
    }
    if (selection.length > 1) {
      figma.ui.postMessage({
        type: "error",
        error:
          "Multiple frames selected. Please select only one frame, component, or instance.",
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
          "Invalid selection. Please select a frame, component, or instance.",
      });
      return;
    }

    figma.ui.postMessage({
      type: "loading",
      message: "Exporting image and getting review...",
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
      console.error("Error getting review:", error);
      let errorMessage =
        "Failed to get review. Please check your API key and network connection.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      figma.ui.postMessage({ type: "error", error: errorMessage });
    }
  }
};
