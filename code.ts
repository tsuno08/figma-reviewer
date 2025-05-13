import { GoogleGenerativeAI } from "@google/generative-ai";

// This plugin will open a window to prompt the user to enter a number, and
// it will then create that many rectangles on the screen.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 300, height: 400 });

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = async (msg: { type: string; apiKey?: string }) => {
  if (msg.type === "get-review") {
    const { apiKey } = msg;
    if (!apiKey) {
      figma.ui.postMessage({ type: "error", error: "API Key is missing." });
      return;
    }

    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({
        type: "error",
        error: "Please select a frame to review.",
      });
      return;
    }
    if (selection.length > 1) {
      figma.ui.postMessage({
        type: "error",
        error: "Please select only one frame.",
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
        error: "Please select a frame, component, or instance.",
      });
      return;
    }

    try {
      // Export the selected frame as an image
      const exportSettings: ExportSettingsImage = { format: "PNG" };
      const imageBytes = await selectedFrame.exportAsync(exportSettings);

      // Initialize Google Generative AI
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

      const imagePart = {
        inlineData: {
          data: Buffer.from(imageBytes).toString("base64"),
          mimeType: "image/png",
        },
      };

      const prompt =
        "Please review the following UI design. Provide feedback on its usability, visual appeal, and any potential areas for improvement. Consider aspects like layout, color scheme, typography, and overall user experience.";

      const result = await model.generateContent([prompt, imagePart]);
      const response = result.response;
      const reviewText = response.text();

      figma.ui.postMessage({ type: "review-result", review: reviewText });
    } catch (error) {
      console.error("Error getting review:", error);
      let errorMessage = "Failed to get review.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      figma.ui.postMessage({ type: "error", error: errorMessage });
    }
  }
};
