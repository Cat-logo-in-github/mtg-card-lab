const API =
  "https://mtgcardgenerator.azurewebsites.net/api";

const promptInput = document.getElementById("prompt");
const generateButton = document.getElementById("generate");
const status = document.getElementById("status");
const result = document.getElementById("result");

generateButton.addEventListener("click", generateCard);

async function generateCard() {
  const prompt = promptInput.value.trim();

  if (!prompt) {
    status.textContent = "Describe the card first.";
    return;
  }

  generateButton.disabled = true;
  result.innerHTML = "";
  status.textContent = "Generating your card...";

  try {
    const params = new URLSearchParams({
      userPrompt: prompt,
      model: "gpt-41",
      imageModel: "imagen-4-fast",
      generateImagePrompt: "true",
      extraCreative: "true"
    });

    const response = await fetch(
      `${API}/GenerateMagicCard?${params}`
    );

    if (!response.ok) {
      throw new Error(`Generation request failed (${response.status})`);
    }

    const request = await response.json();

    status.textContent = "Creating artwork...";

    const card = await waitForCard(request.id);

    showCard(card);
    status.textContent = "Done.";
  } catch (error) {
    console.error(error);
    status.textContent =
      "Something went wrong. Check the browser console for details.";
  } finally {
    generateButton.disabled = false;
  }
}

async function waitForCard(id) {
  for (let i = 0; i < 60; i++) {
    await sleep(2000);

    const response = await fetch(
      `${API}/GetMagicCardGenerationStatus?instanceId=${encodeURIComponent(id)}`
    );

    if (!response.ok) {
      throw new Error(`Status request failed (${response.status})`);
    }

    const data = await response.json();

    if (data.runtimeStatus === "Completed") {
      if (data.customStatus !== "success") {
        throw new Error("Card generation failed.");
      }

      return data.output.cards[0];
    }

    if (
      data.runtimeStatus === "Failed" ||
      data.runtimeStatus === "Terminated"
    ) {
      throw new Error("Card generation failed.");
    }
  }

  throw new Error("Generation timed out.");
}

function showCard(card) {
  result.innerHTML = `
    <img src="${escapeAttribute(card.imageUrl)}" alt="${escapeAttribute(card.name)}">

    <div class="card-info">
      <strong>${escapeHtml(card.name)}</strong>
      <p>${escapeHtml(card.typeLine || card.type || "")}</p>
      <p>${escapeHtml(card.oracleText || "")}</p>
    </div>
  `;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
