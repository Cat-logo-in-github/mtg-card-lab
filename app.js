const API = "https://api.scryfall.com/cards/search?q=";

const queryBox = document.getElementById("query");
const searchButton = document.getElementById("search");
const randomButton = document.getElementById("random");
const status = document.getElementById("status");
const results = document.getElementById("results");
const interpretation = document.getElementById("interpretation");

searchButton.onclick = search;

queryBox.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    search();
  }
});

randomButton.onclick = () => {
  const examples = [
    "cheap green creatures that make mana",
    "blue cards that draw cards",
    "creatures that sacrifice themselves to draw cards",
    "black creatures that return from the graveyard",
    "red spells that deal damage",
    "cheap artifacts that generate value"
  ];

  queryBox.value = examples[Math.floor(Math.random() * examples.length)];
  search();
};

async function search() {
  const text = queryBox.value.trim();

  if (!text) return;

  const parsed = interpret(text);
  const scryfallQuery = buildQuery(parsed);

  interpretation.innerHTML =
    `<span>Interpreted as:</span> ${escapeHtml(parsed.description)}`;

  status.textContent = "Finding cards...";
  results.innerHTML = "";

  try {
    const response = await fetch(
      API + encodeURIComponent(scryfallQuery)
    );

    if (!response.ok) {
      throw new Error("Scryfall returned " + response.status);
    }

    const data = await response.json();

    status.textContent =
      data.total_cards === 1
        ? "1 card found"
        : `${data.total_cards.toLocaleString()} cards found`;

    render(data.data);

  } catch (error) {
    console.error(error);

    status.textContent = "Search failed.";
    results.innerHTML = `
      <div class="empty">
        We couldn't find cards for that search.
      </div>
    `;
  }
}


/*
  Tiny local "semantic" interpreter.

  It does not call an AI.
  It converts natural language into structured search intent.
*/
function interpret(text) {
  const q = text.toLowerCase();

  const result = {
    colors: [],
    type: null,
    maxMana: null,
    minMana: null,
    oracle: [],
    keywords: [],
    description: text
  };

  const colors = {
    white: "w",
    blue: "u",
    black: "b",
    red: "r",
    green: "g",
    colorless: "c"
  };

  for (const [name, code] of Object.entries(colors)) {
    if (q.includes(name)) result.colors.push(code);
  }

  const types = [
    "creature",
    "artifact",
    "enchantment",
    "instant",
    "sorcery",
    "planeswalker",
    "land",
    "battle"
  ];

  for (const type of types) {
    if (q.includes(type)) {
      result.type = type;
      break;
    }
  }

  if (/\bcheap\b|\blow cost\b|\blow mana\b/.test(q)) {
    result.maxMana = 3;
  }

  const manaMatch = q.match(
    /(?:mana value|cost|mana)[^\d]*(\d+)/
  );

  if (manaMatch) {
    result.maxMana = Number(manaMatch[1]);
  }

  const patterns = [
    ["draw", ["draw"]],
    ["card draw", ["draw"]],
    ["mana", ["mana"]],
    ["ramp", ["add", "mana"]],
    ["sacrifice", ["sacrifice"]],
    ["sacrifice themselves", ["sacrifice"]],
    ["graveyard", ["graveyard"]],
    ["return from the graveyard", ["graveyard"]],
    ["destroy", ["destroy"]],
    ["damage", ["damage"]],
    ["discard", ["discard"]],
    ["counter spells", ["counter target spell"]],
    ["counterspell", ["counter target spell"]],
    ["tokens", ["token"]],
    ["token", ["token"]],
    ["life gain", ["gain life"]],
    ["gain life", ["gain life"]],
    ["flying", ["flying"]],
    ["haste", ["haste"]],
    ["trample", ["trample"]],
    ["deathtouch", ["deathtouch"]],
    ["lifelink", ["lifelink"]]
  ];

  for (const [phrase, terms] of patterns) {
    if (q.includes(phrase)) {
      for (const term of terms) {
        if (!result.oracle.includes(term)) {
          result.oracle.push(term);
        }
      }
    }
  }

  const pieces = [];

  if (result.colors.length)
    pieces.push("color: " + result.colors.join(", "));

  if (result.type)
    pieces.push("type: " + result.type);

  if (result.maxMana !== null)
    pieces.push("mana value ≤ " + result.maxMana);

  if (result.oracle.length)
    pieces.push("does: " + result.oracle.join(", "));

  result.description =
    pieces.length
      ? pieces.join("  ·  ")
      : "broad card search";

  return result;
}


function buildQuery(result) {
  const parts = [];

  if (result.colors.length) {
    parts.push(`c:${result.colors.join("")}`);
  }

  if (result.type) {
    parts.push(`t:${result.type}`);
  }

  if (result.maxMana !== null) {
    parts.push(`mv<=${result.maxMana}`);
  }

  for (const term of result.oracle) {
    parts.push(`o:${JSON.stringify(term)}`);
  }

  /*
    If our interpreter found nothing specific,
    use the user's words as an ordinary Scryfall search.
  */
  if (!parts.length) {
    return result.description;
  }

  return parts.join(" ");
}


function render(cards) {
  if (!cards.length) {
    results.innerHTML = `
      <div class="empty">
        No cards matched that description.
        <br><br>
        Try changing the wording.
      </div>
    `;
    return;
  }

  results.innerHTML = cards
    .slice(0, 24)
    .map((card, index) => {
      const image =
        card.image_uris?.normal ||
        card.card_faces?.[0]?.image_uris?.normal;

      if (!image) return "";

      return `
        <article
          class="card"
          data-index="${index}"
          onclick="openCard(${index})">

          <img
            src="${escapeHtml(image)}"
            alt="${escapeHtml(card.name)}"
            loading="lazy"
          >

          <div class="card-name">
            ${escapeHtml(card.name)}
          </div>

          <div class="card-type">
            ${escapeHtml(card.type_line || "")}
          </div>
        </article>
      `;
    })
    .join("");

  window.currentCards = cards.slice(0, 24);
}


window.openCard = function(index) {
  const card = window.currentCards[index];

  const image =
    card.image_uris?.large ||
    card.card_faces?.[0]?.image_uris?.large;

  document.getElementById("modal-image").src = image;
  document.getElementById("modal-image").alt = card.name;

  document.getElementById("modal-info").innerHTML = `
    <h2>${escapeHtml(card.name)}</h2>

    <div class="label">Mana</div>
    <div>${escapeHtml(card.mana_cost || "")}</div>

    <div class="label">Type</div>
    <div>${escapeHtml(card.type_line || "")}</div>

    <div class="label">Rules</div>
    <div>${escapeHtml(card.oracle_text || "—")}</div>

    ${
      card.flavor_text
        ? `
          <div class="label">Flavor</div>
          <div><em>${escapeHtml(card.flavor_text)}</em></div>
        `
        : ""
    }

    <div class="label">Set</div>
    <div>${escapeHtml(card.set_name || "")}</div>

    <br>

    <a
      href="${escapeHtml(card.scryfall_uri)}"
      target="_blank"
      style="color:#d4af67">
      View on Scryfall →
    </a>
  `;

  document.getElementById("modal").classList.remove("hidden");
};


document.getElementById("close").onclick = closeModal;

document.getElementById("modal").onclick = event => {
  if (event.target.id === "modal") {
    closeModal();
  }
};

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
