// =================================================================================
// Constants
// =================================================================================

const INITIAL_PROMPT =
  "以下のUIデザインをレビューしてください。ユーザビリティ、視覚的な魅力、改善点の可能性についてフィードバックをお願いします。レイアウト、配色、タイポグラフィ、全体的なユーザーエクスペリエンスなどの側面を考慮してください。800文字以内で簡潔に、日本語で回答してください。\n\n回答の形式について：\n- 見出しには '#' を使用可能です\n- 箇条書きには '-' を使用可能です\n- 太字、斜体、コードブロックなどの装飾的な記法の使用は避けてください";
const GEMINI_MODEL_NAME = "gemini-1.5-flash"; // Updated model name
const STORAGE_API_KEY = "gemini-api-key";
const STORAGE_FIGMA_TOKEN = "figma-token";

// =================================================================================
// Type Definitions
// =================================================================================

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

type GeminiRequestBody = {
  contents: Array<{
    role: "user";
    parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>;
  }>;
};

// =================================================================================
// Utility Functions
// =================================================================================

/**
 * Retrieves the Gemini API key from client storage.
 * @returns A promise that resolves to the API key string if found, or undefined otherwise.
 */
async function getApiKey(): Promise<string | undefined> {
  return figma.clientStorage.getAsync(STORAGE_API_KEY);
}

/**
 * Saves the Gemini API key to client storage.
 * @param apiKey The API key string to save.
 * @returns A promise that resolves when the key is saved.
 */
async function saveApiKey(apiKey: string): Promise<void> {
  return figma.clientStorage.setAsync(STORAGE_API_KEY, apiKey);
}

/**
 * Retrieves the Figma token from client storage.
 * @returns A promise that resolves to the Figma token string if found, or undefined otherwise.
 */
async function getFigmaToken(): Promise<string | undefined> {
  return figma.clientStorage.getAsync(STORAGE_FIGMA_TOKEN);
}

/**
 * Saves the Figma token to client storage.
 * @param figmaToken The Figma token string to save.
 * @returns A promise that resolves when the token is saved.
 */
async function saveFigmaToken(figmaToken: string): Promise<void> {
  return figma.clientStorage.setAsync(STORAGE_FIGMA_TOKEN, figmaToken);
}

/**
 * Validates the current Figma selection.
 * Checks if exactly one frame, component, or instance is selected.
 * Notifies the user and posts a "finished" message to the UI if validation fails.
 * @returns The selected SceneNode if valid, or null otherwise.
 */
function validateSelection(): SceneNode | null {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.notify("フレーム、コンポーネント、またはインスタンスを選択してください。");
    figma.ui.postMessage({ type: "finished" });
    return null;
  }
  if (selection.length > 1) {
    figma.notify("1つだけ選択してください。");
    figma.ui.postMessage({ type: "finished" });
    return null;
  }

  const selectedNode = selection[0];
  if (
    selectedNode.type !== "FRAME" &&
    selectedNode.type !== "COMPONENT" &&
    selectedNode.type !== "INSTANCE"
  ) {
    figma.notify("フレーム、コンポーネント、またはインスタンスを選択してください。");
    figma.ui.postMessage({ type: "finished" });
    return null;
  }
  return selectedNode;
}

/**
 * Exports a given SceneNode as a PNG image.
 * Notifies the user and posts a "finished" message to the UI if export fails.
 * @param node The SceneNode to export.
 * @returns A promise that resolves to a Uint8Array of the PNG data if successful, or null otherwise.
 */
async function exportNodeAsPng(node: SceneNode): Promise<Uint8Array | null> {
  try {
    const imageBytes = await node.exportAsync({ format: "PNG" });
    return imageBytes;
  } catch (error) {
    if (error instanceof Error) {
      figma.notify(`画像のエクスポートに失敗しました: ${error.message}`);
    } else {
      figma.notify(`画像のエクスポート中に不明なエラーが発生しました`);
    }
    figma.ui.postMessage({ type: "finished" });
    return null;
  }
}

/**
 * Sends a request to the Gemini API to generate content based on the provided image and prompt.
 * Implements a retry mechanism for 503 errors.
 * @param apiKey The Gemini API key.
 * @param requestBody The body of the request to the Gemini API.
 * @param retryCount The current retry attempt count.
 * @returns A promise that resolves to the Gemini API response.
 * @throws Will throw an error if the API request fails after retries or for other reasons.
 */
const requestGeminiAPI = async (
  apiKey: string,
  requestBody: GeminiRequestBody,
  retryCount = 0
): Promise<GeminiResponse> => {
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
      const waitTime = Math.pow(2, retryCount) * 1000;
      figma.ui.postMessage({ type: "retry-notification", message: `サーバーが混雑しています。${waitTime / 1000}秒後に再試行します...` });
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return requestGeminiAPI(apiKey, requestBody, retryCount + 1);
    }

    if (response.status === 503) {
      throw new Error(`サーバーがビジー状態です。再試行の上限に達しました (${retryCount} 回)。`);
    }

    if (!response.ok) {
      throw new Error(`APIリクエストに失敗しました: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as GeminiResponse;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`APIリクエスト中に不明なエラーが発生しました: ${error}`);
  }
};

/**
 * Posts a review comment to a Figma file.
 * @param figmaToken The Figma API token.
 * @param fileKey The key of the Figma file.
 * @param nodeId The ID of the node to comment on.
 * @param reviewText The text content of the review.
 * @returns A promise that resolves to true if the comment was posted successfully, false otherwise.
 */
async function postReviewCommentToFigma(figmaToken: string, fileKey: string, nodeId: string, reviewText: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.figma.com/v1/files/${fileKey}/comments`,
      {
        method: "POST",
        headers: {
          "X-FIGMA-TOKEN": figmaToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: reviewText,
          client_meta: { node_id: nodeId, node_offset: { x: 0, y: 0 } },
          pinned_node: nodeId,
        }),
      }
    );

    if (response.ok) {
      figma.notify("レビューをコメントとして追加しました");
      return true;
    } else {
      figma.notify(`コメントの追加に失敗しました: ${response.status}`);
      return false;
    }
  } catch (error) {
    if (error instanceof Error) {
      figma.notify(`コメントAPIリクエスト中にエラーが発生しました: ${error.message}`);
    } else {
      figma.notify(`コメントAPIリクエスト中に不明なエラーが発生しました`);
    }
    return false;
  }
}

// =================================================================================
// Main Plugin Logic
// =================================================================================

figma.showUI(__html__, { width: 400, height: 400 });

figma.ui.onmessage = async (msg: PluginMessage) => {
  switch (msg.type) {
    case "load-api-key":
      const savedApiKey = await getApiKey();
      if (savedApiKey) {
        figma.ui.postMessage({ type: "api-key-loaded", apiKey: savedApiKey });
      }
      break;
    case "load-figma-token":
      const savedToken = await getFigmaToken();
      if (savedToken) {
        figma.ui.postMessage({
          type: "figma-token-loaded",
          figmaToken: savedToken,
        });
      }
      break;
    case "load-gemini-api": // This case seems to only post a message back to UI.
      figma.ui.postMessage({
        type: "load-gemini-api",
      });
      break;
    case "get-review":
      const { apiKey, figmaToken, additionalPrompt } = msg;
      let currentApiKey = apiKey;
      let currentFigmaToken = figmaToken;

      if (!currentApiKey || !currentFigmaToken) {
        const storedApiKey = await getApiKey();
        const storedFigmaToken = await getFigmaToken();

        if (!storedApiKey || !storedFigmaToken) {
          let missingItems = [];
          if (!storedApiKey) missingItems.push("APIキー");
          if (!storedFigmaToken) missingItems.push("Figmaトークン");
          figma.notify(`${missingItems.join("と")}が入力されていません。`);
          figma.ui.postMessage({ type: "finished" });
          return;
        }
        currentApiKey = storedApiKey;
        currentFigmaToken = storedFigmaToken;
        // Update message object for later use if needed, though current logic uses individual vars
        msg.apiKey = storedApiKey;
        msg.figmaToken = storedFigmaToken;
      } else {
        // Save the provided tokens if they were input by the user
        if (apiKey) await saveApiKey(apiKey);
        if (figmaToken) await saveFigmaToken(figmaToken);
      }

      const selectedNode = validateSelection();
      if (!selectedNode) {
        // validateSelection already notifies and posts 'finished'
        return;
      }

      figma.notify("レビューを取得中...");

      try {
        const imageBytes = await exportNodeAsPng(selectedNode);
        if (!imageBytes) {
          // exportNodeAsPng already notifies and posts 'finished'
          return;
        }

        const imagePart = {
          inlineData: {
            data: figma.base64Encode(imageBytes),
            mimeType: "image/png",
          },
        };

        const fullPrompt = additionalPrompt
          ? `${INITIAL_PROMPT} ${additionalPrompt}`
          : INITIAL_PROMPT;

        const requestBody: GeminiRequestBody = { // Ensure type safety
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

        // Use currentApiKey and ensure it's non-null
        // The previous checks should guarantee currentApiKey is defined.
        const result = await requestGeminiAPI(currentApiKey!, requestBody);

        if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
          figma.notify("レビューの取得に失敗しました。APIからのレスポンス形式が正しくありません。");
          figma.ui.postMessage({ type: "finished" });
          return;
        }
        const reviewText = result.candidates[0].content.parts[0].text;

        figma.notify("レビューを追加しています...");
        const fileKey = figma.fileKey;
        if (!fileKey) {
            figma.notify("ファイルのキーが取得できませんでした。Figmaファイルが正しく開かれているか確認してください。");
            figma.ui.postMessage({ type: "finished" });
            return;
        }

        // Ensure currentFigmaToken is non-null
        const commentPosted = await postReviewCommentToFigma(currentFigmaToken!, fileKey, selectedNode.id, reviewText);

        if (commentPosted) {
          figma.closePlugin();
        } else {
          // postReviewCommentToFigma already notifies
          figma.ui.postMessage({ type: "finished" });
          // No return here, as it's the end of the try block for this path.
        }
      } catch (error) {
        let errorMessage = "レビューの取得中に予期せぬエラーが発生しました。";
        if (error instanceof Error) {
          errorMessage = error.message; // This will use the specific error from requestGeminiAPI or other steps
        }
        figma.notify(errorMessage);
        figma.ui.postMessage({ type: "finished" });
      }
      break;
  }
};
