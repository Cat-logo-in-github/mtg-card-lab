document.addEventListener("DOMContentLoaded", () => {

  const query = document.getElementById("query");
  const search = document.getElementById("search");
  const random = document.getElementById("random");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const interpretation = document.getElementById("interpretation");
  const modal = document.getElementById("modal");
  const close = document.getElementById("close");

  let cards = [];

  if (!query || !search || !results) {
    console.error("MTG Card Lab: required HTML elements are missing.");
    return;
  }

  search.onclick = runSearch;

  query.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      runSearch();
    }
  });

  random.onclick = () => {
    const examples = [
      "cheap green creatures that make mana",
      "blue cards that draw cards",
      "black creatures that return from the graveyard",
      "red spells that deal damage",
      "cheap artifacts that generate value",
      "white creatures that gain life"
    ];

    query.value =
      examples[Math.floor(Math.random() * examples.length)];

    runSearch();
  };

  document.querySelectorAll(".examples button").forEach(button => {
    button.onclick = () => {
      query.value = button.dataset.query;
      runSearch();
    };
  });

  close.onclick = () => modal.classList.add("hidden");

  modal.onclick = event => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  };


  async function runSearch() {

    const text = query.value.trim();

    if (!text) return;

    const intent = interpret(text);
    const scryfallQuery = buildQuery(intent);

    interpretation.textContent =
      "Searching for: " + intent.description;

    status.textContent = "Finding cards…";
    results.innerHTML = "";

    try {

      const url =
        "https://api.scryfall.com/cards/search?q=" +
        encodeURIComponent(scryfallQuery);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Scryfall HTTP " + response.status);
      }

      const data = await response.json();

      cards = data.data || [];

      if (!cards.length) {
        status.textContent = "No cards found.";
        results.innerHTML =
          `<div class="empty">
            No cards matched that description.<br>
            Try another description.
          </div>`;
        return;
      }

      status.textContent =
        `${data.total_cards.toLocaleString()} cards found`;

      render();

    } catch (error) {

      console.error(error);

      status.textContent = "Something went wrong.";

      results.innerHTML =
        `<div class="empty">
          Couldn't reach the card database.<br>
          Please try again.
        </div>`;
    }
  }


  function interpret(text) {

    const q = text.toLowerCase();

    const intent = {
      colors: [],
      type: null,
      maxMana: null,
      oracle: [],
      description: text
    };


    const colorMap = {
      white: "w",
      blue: "u",
      black: "b",
      red: "r",
      green: "g",
      colorless: "c"
    };

    for (const [word, code] of Object.entries(colorMap)) {
      if (q.includes(word)) {
        intent.colors.push(code);
      }
    }


    const types = [
      "creature",
      "artifact",
      "enchantment",
      "planeswalker",
      "instant",
      "sorcery",
      "land",
      "battle"
    ];

    for (const type of types) {
      if (q.includes(type)) {
        intent.type = type;
        break;
      }
    }


    if (
      q.includes("cheap") ||
      q.includes("low cost") ||
      q.includes("low mana")
    ) {
      intent.maxMana = 3;
    }


    const mana =
      q.match(/(?:mana value|cost|mana)[^\d]*(\d+)/);

    if (mana) {
      intent.maxMana = Number(mana[1]);
    }


    const concepts = [
      ["draw cards", "draw"],
      ["draw a card", "draw"],
      ["card draw", "draw"],
      ["make mana", "mana"],
      ["makes mana", "mana"],
      ["generate mana", "mana"],
      ["ramp", "mana"],
      ["sacrifice", "sacrifice"],
      ["graveyard", "graveyard"],
      ["return from the graveyard", "graveyard"],
      ["destroy", "destroy"],
      ["damage", "damage"],
      ["burn", "damage"],
      ["discard", "discard"],
      ["token", "token"],
      ["tokens", "token"],
      ["gain life", "gain life"],
      ["life gain", "gain life"],
      ["flying", "flying"],
      ["haste", "haste"],
      ["trample", "trample"],
      ["deathtouch", "deathtouch"],
      ["lifelink", "lifelink"],
      ["counter spells", "counter target spell"],
      ["counterspell", "counter target spell"]
    ];

    for (const [phrase, oracleTerm] of concepts) {
      if (q.includes(phrase) && !intent.oracle.includes(oracleTerm)) {
        intent.oracle.push(oracleTerm);
      }
    }


    const description = [];

    if (intent.colors.length)
      description.push("color");

    if (intent.type)
      description.push(intent.type);

    if (intent.maxMana !== null)
      description.push("mana value ≤ " + intent.maxMana);

    if (intent.oracle.length)
      description.push(intent.oracle.join(", "));

    intent.description =
      description.length
        ? description.join(" · ")
        : "broad search";

    return intent;
  }


  function buildQuery(intent) {

    const parts = [];

    if (intent.colors.length) {
      parts.push(`c:${intent.colors.join("")}`);
    }

    if (intent.type) {
      parts.push(`t:${intent.type}`);
    }

    if (intent.maxMana !== null) {
      parts.push(`mv<=${intent.maxMana}`);
    }

    for (const term of intent.oracle) {
      parts.push(`o:"${term}"`);
    }

    if (!parts.length) {
      return intent.description;
    }

    return parts.join(" ");
  }


  function render() {

    results.innerHTML = cards
      .slice(0, 24)
      .map((card, index) => {

        const image =
          card.image_uris?.normal ||
          card.card_faces?.[0]?.image_uris?.normal;

        if (!image) return "";

        return `
          <article class="card" data-index="${index}">
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

    document.querySelectorAll(".card").forEach(card => {
      card.onclick = () => {
        openCard(Number(card.dataset.index));
      };
    });
  }


  function openCard(index) {

    const card = cards[index];

    if (!card) return;

    const image =
      card.image_uris?.large ||
      card.card_faces?.[0]?.image_uris?.large;

    document.getElementById("modal-image").src = image;
    document.getElementById("modal-image").alt = card.name;

    document.getElementById("modal-details").innerHTML = `
      <h2>${escapeHtml(card.name)}</h2>

      <div class="detail-label">Mana</div>
      <div>${escapeHtml(card.mana_cost || "—")}</div>

      <div class="detail-label">Type</div>
      <div>${escapeHtml(card.type_line || "—")}</div>

      <div class="detail-label">Rules</div>
      <div>${escapeHtml(card.oracle_text || "—")}</div>

      ${
        card.flavor_text
          ? `
            <div class="detail-label">Flavor</div>
            <div><em>${escapeHtml(card.flavor_text)}</em></div>
          `
          : ""
      }

      <div class="detail-label">Set</div>
      <div>${escapeHtml(card.set_name || "—")}</div>

      <br>

      <a
        href="${escapeHtml(card.scryfall_uri)}"
        target="_blank"
        style="color:#d4af67">
        View on Scryfall →
      </a>
    `;

    modal.classList.remove("hidden");
  }


  function escapeHtml(value) {

    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

});
