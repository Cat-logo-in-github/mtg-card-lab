document.addEventListener("DOMContentLoaded", () => {
  const queryBox = document.getElementById("query");
  const searchButton = document.getElementById("search");
  const randomButton = document.getElementById("random");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const interpretation = document.getElementById("interpretation");
  const modal = document.getElementById("modal");
  const close = document.getElementById("close");

  const API = "https://api.scryfall.com/cards/search?q=";

  let cards = [];

  if (!queryBox || !searchButton || !status || !results) {
    console.error("Card Lab: required HTML elements are missing.");
    return;
  }


  // ============================================================
  // SEARCH
  // ============================================================

  searchButton.addEventListener("click", runSearch);

  queryBox.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      runSearch();
    }
  });


  if (randomButton) {
    randomButton.addEventListener("click", () => {

      const examples = [
        "red vampires similar to Sorin",
        "cheap green creatures that make mana",
        "blue cards that draw lots of cards",
        "black creatures that come back from the graveyard",
        "white creatures that make tokens",
        "creatures with flying and lifelink",
        "cards like Lightning Bolt but cheaper",
        "cheap artifacts that generate value",
        "commander cards for a sacrifice deck",
        "red creatures that deal damage when they die",
        "cards that exile graveyards",
        "spells that counter creatures",
        "green creatures with trample",
        "cards that let me play extra lands"
      ];

      queryBox.value =
        examples[Math.floor(Math.random() * examples.length)];

      runSearch();
    });
  }


  document.querySelectorAll(".examples button").forEach(button => {
    button.addEventListener("click", () => {
      queryBox.value = button.dataset.query || "";
      runSearch();
    });
  });


  if (close && modal) {

    close.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    modal.addEventListener("click", event => {
      if (event.target === modal) {
        modal.classList.add("hidden");
      }
    });
  }


  // ============================================================
  // MAIN SEARCH PIPELINE
  //
  // 1. Understand language
  // 2. Retrieve candidates
  // 3. Resolve reference cards
  // 4. Score candidates
  // 5. Sort by score
  // ============================================================

  async function runSearch() {

    const text = queryBox.value.trim();

    if (!text) {
      queryBox.focus();
      return;
    }

    const intent = interpret(text);

    showInterpretation(intent);

    status.textContent = "Understanding your request…";
    results.innerHTML = "";

    try {

      // Build a broad query.
      // We intentionally avoid putting every semantic concept
      // into Scryfall because that can make retrieval too narrow.
      const retrievalQuery = buildRetrievalQuery(intent);

      status.textContent = "Finding candidate cards…";

      const cardsFound = await searchScryfall(
        retrievalQuery
      );

      if (!cardsFound.length) {

        status.textContent = "No cards found.";

        results.innerHTML = `
          <div class="empty">
            No cards matched the search.
            <br><br>
            Try a broader description.
          </div>
        `;

        return;
      }


      // --------------------------------------------------------
      // Resolve references such as:
      //
      // "similar to Sorin"
      // "like Lightning Bolt"
      // --------------------------------------------------------

      let references = [];

      if (intent.references.length) {

        status.textContent =
          "Comparing against reference cards…";

        references =
          await resolveReferences(
            intent.references
          );
      }


      // --------------------------------------------------------
      // Score everything locally.
      // --------------------------------------------------------

      status.textContent =
        "Ranking the best matches…";

      cards = cardsFound
        .map(card => {

          const score = scoreCard(
            card,
            intent,
            references
          );

          return {
            ...card,
            _match: score
          };
        })
        .sort(
          (a, b) =>
            b._match.total -
            a._match.total
        );


      status.textContent =
        `${cards.length.toLocaleString()} candidates ranked`;

      renderCards();

    } catch (error) {

      console.error("Card Lab:", error);

      status.textContent = "Search failed.";

      results.innerHTML = `
        <div class="empty">
          Something went wrong while searching.
          <br><br>
          Please try again.
        </div>
      `;
    }
  }


  // ============================================================
  // SCRYFALL
  // ============================================================

  async function searchScryfall(q) {

    const response = await fetch(
      API + encodeURIComponent(q),
      {
        headers: {
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {

      if (response.status === 404) {
        return [];
      }

      throw new Error(
        `Scryfall HTTP ${response.status}`
      );
    }

    const data = await response.json();

    return data.data || [];
  }


  // ============================================================
  // INTENT
  // ============================================================

  function interpret(original) {

    const q = normalize(original);

    const intent = {

      original_query: original,

      colors: [],

      type: null,

      subtypes: [],

      supertypes: [],

      mana_value: {
        min: null,
        max: null,
        exact: null
      },

      power: {
        min: null,
        max: null
      },

      toughness: {
        min: null,
        max: null
      },

      keywords: [],

      concepts: [],

      zones: [],

      strategies: [],

      formats: [],

      rarities: [],

      sets: [],

      references: [],

      exclusions: [],

      preferences: []
    };


    parseColors(q, intent);
    parseTypes(q, intent);
    parseSubtypes(q, intent);
    parseSupertypes(q, intent);

    parseMana(q, intent);
    parsePower(q, intent);
    parseToughness(q, intent);

    parseKeywords(q, intent);
    parseConcepts(q, intent);
    parseZones(q, intent);
    parseStrategies(q, intent);
    parseFormats(q, intent);
    parseRarity(q, intent);
    parseSets(q, intent);

    parseReferences(original, intent);

    parseNegations(q, intent);
    parsePreferences(q, intent);

    return intent;
  }


  // ============================================================
  // COLORS
  // ============================================================

  function parseColors(q, intent) {

    const colors = {
      white: "w",
      blue: "u",
      black: "b",
      red: "r",
      green: "g",
      colorless: "c"
    };

    for (const [name, code] of Object.entries(colors)) {

      if (wordExists(q, name)) {
        addUnique(intent.colors, code);
      }
    }


    const identities = {
      azorius: ["w", "u"],
      dimir: ["u", "b"],
      rakdos: ["b", "r"],
      gruul: ["r", "g"],
      selesnya: ["g", "w"],
      orzhov: ["w", "b"],
      izzet: ["u", "r"],
      golgari: ["b", "g"],
      simic: ["g", "u"],
      boros: ["r", "w"],

      jeskai: ["w", "u", "r"],
      sultai: ["u", "b", "g"],
      mardu: ["w", "b", "r"],
      temur: ["u", "r", "g"],
      abzan: ["w", "b", "g"],

      bant: ["w", "u", "g"],
      esper: ["w", "u", "b"],
      grixis: ["u", "b", "r"],
      naya: ["r", "g", "w"]
    };


    for (const [name, value] of Object.entries(identities)) {

      if (q.includes(name)) {
        intent.colors = [...value];
      }
    }


    const mono = q.match(
      /\bmono[- ](white|blue|black|red|green)\b/
    );

    if (mono) {

      const map = {
        white: "w",
        blue: "u",
        black: "b",
        red: "r",
        green: "g"
      };

      intent.colors = [map[mono[1]]];
    }
  }


  // ============================================================
  // TYPES
  // ============================================================

  function parseTypes(q, intent) {

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

      if (wordExists(q, type)) {
        intent.type = type;
        break;
      }
    }
  }


  // ============================================================
  // SUBTYPES
  // ============================================================

  function parseSubtypes(q, intent) {

    const subtypes = [
      "vampire",
      "wizard",
      "elf",
      "goblin",
      "dragon",
      "human",
      "zombie",
      "angel",
      "demon",
      "devil",
      "spirit",
      "merfolk",
      "soldier",
      "knight",
      "warrior",
      "rogue",
      "cleric",
      "druid",
      "shaman",
      "beast",
      "bird",
      "cat",
      "dog",
      "wolf",
      "werewolf",
      "snake",
      "serpent",
      "insect",
      "elemental",
      "faerie",
      "fairy",
      "golem",
      "construct",
      "giant",
      "horror",
      "skeleton",
      "pirate",
      "ninja",
      "samurai",
      "monk",
      "assassin",
      "berserker",
      "octopus",
      "kraken",
      "leviathan",
      "phyrexian",
      "eldrazi",
      "sliver",
      "fungus",
      "treefolk",
      "dryad",
      "spider",
      "hydra"
    ];

    for (const subtype of subtypes) {

      if (wordExists(q, subtype)) {
        addUnique(
          intent.subtypes,
          subtype
        );
      }
    }
  }


  // ============================================================
  // SUPERTYPES
  // ============================================================

  function parseSupertypes(q, intent) {

    [
      "legendary",
      "snow",
      "basic",
      "world"
    ].forEach(value => {

      if (wordExists(q, value)) {
        addUnique(
          intent.supertypes,
          value
        );
      }
    });
  }


  // ============================================================
  // MANA
  // ============================================================

  function parseMana(q, intent) {

    if (
      /\bcheap\b/.test(q) ||
      /\blow[- ]cost\b/.test(q) ||
      /\blow[- ]mana\b/.test(q)
    ) {
      intent.mana_value.max = 3;
    }


    if (
      /\bexpensive\b/.test(q) ||
      /\bhigh[- ]cost\b/.test(q)
    ) {
      intent.mana_value.min = 5;
    }


    let m = q.match(
      /(?:mana value|mv)\s*(?:of|=|is)?\s*(\d+)/
    );

    if (m) {
      intent.mana_value.exact =
        Number(m[1]);
    }


    m = q.match(
      /(?:under|below|less than|at most|up to)\s+(\d+)\s*(?:mana|mv|mana value)?/
    );

    if (m) {
      intent.mana_value.max =
        Number(m[1]);
    }


    m = q.match(
      /(?:over|above|more than|at least)\s+(\d+)\s*(?:mana|mv|mana value)?/
    );

    if (m) {
      intent.mana_value.min =
        Number(m[1]);
    }
  }


  // ============================================================
  // POWER / TOUGHNESS
  // ============================================================

  function parsePower(q, intent) {

    let m = q.match(
      /power\s*(?:at least|>=|over|above)\s*(\d+)/
    );

    if (m) {
      intent.power.min = Number(m[1]);
    }

    m = q.match(
      /power\s*(?:at most|<=|under|below)\s*(\d+)/
    );

    if (m) {
      intent.power.max = Number(m[1]);
    }
  }


  function parseToughness(q, intent) {

    let m = q.match(
      /toughness\s*(?:at least|>=|over|above)\s*(\d+)/
    );

    if (m) {
      intent.toughness.min = Number(m[1]);
    }

    m = q.match(
      /toughness\s*(?:at most|<=|under|below)\s*(\d+)/
    );

    if (m) {
      intent.toughness.max = Number(m[1]);
    }
  }


  // ============================================================
  // KEYWORDS
  // ============================================================

  function parseKeywords(q, intent) {

    const keywords = [
      "flying",
      "haste",
      "trample",
      "deathtouch",
      "lifelink",
      "menace",
      "vigilance",
      "flash",
      "defender",
      "hexproof",
      "indestructible",
      "ward",
      "prowess",
      "first strike",
      "double strike",
      "reach",
      "infect",
      "toxic",
      "cascade",
      "convoke",
      "delve",
      "affinity",
      "cycling",
      "kicker",
      "madness",
      "morph",
      "scry",
      "surveil",
      "investigate",
      "connive",
      "proliferate",
      "landfall",
      "devotion",
      "mutate",
      "escape",
      "flashback",
      "foretell",
      "incubate"
    ];

    for (const keyword of keywords) {

      if (q.includes(keyword)) {
        addUnique(
          intent.keywords,
          keyword
        );
      }
    }
  }


  // ============================================================
  // CONCEPTS
  // ============================================================

  function parseConcepts(q, intent) {

    const groups = {

      draw: [
        "draw cards",
        "draw a card",
        "card draw",
        "draw more cards",
        "cantrip"
      ],

      mana: [
        "make mana",
        "makes mana",
        "generate mana",
        "produces mana",
        "mana dork",
        "mana dorks",
        "ramp",
        "mana acceleration"
      ],

      sacrifice: [
        "sacrifice",
        "sac outlet",
        "sacrifice outlet"
      ],

      graveyard: [
        "graveyard",
        "reanimate",
        "reanimation",
        "return from the graveyard"
      ],

      removal: [
        "removal",
        "destroy creatures",
        "destroy target",
        "kill creatures"
      ],

      exile: [
        "exile",
        "exile target"
      ],

      damage: [
        "damage",
        "deal damage",
        "burn"
      ],

      discard: [
        "discard",
        "hand disruption"
      ],

      counter: [
        "counterspell",
        "counter spell",
        "counter magic"
      ],

      tokens: [
        "make tokens",
        "makes tokens",
        "create tokens",
        "token generation",
        "token maker"
      ],

      lifegain: [
        "gain life",
        "life gain",
        "lifegain"
      ],

      tutor: [
        "tutor",
        "tutors",
        "search your library"
      ],

      mill: [
        "mill",
        "mill cards"
      ],

      blink: [
        "blink",
        "flicker",
        "exile and return"
      ],

      copy: [
        "copy spells",
        "copy a spell",
        "copy creatures",
        "clone"
      ],

      counters: [
        "+1/+1 counters",
        "plus one counters",
        "put counters",
        "counters on creatures"
      ],

      extra_land: [
        "play extra lands",
        "extra land",
        "additional land"
      ],

      pump: [
        "pump",
        "buff creatures",
        "make creatures bigger",
        "anthem"
      ]
    };


    for (const [concept, phrases] of Object.entries(groups)) {

      if (
        phrases.some(
          phrase => q.includes(phrase)
        )
      ) {
        addUnique(
          intent.concepts,
          concept
        );
      }
    }
  }


  // ============================================================
  // ZONES
  // ============================================================

  function parseZones(q, intent) {

    const zones = {
      graveyard: ["graveyard", "gy"],
      library: ["library", "deck"],
      hand: ["hand"],
      battlefield: ["battlefield"],
      exile: ["exile", "exiled"],
      stack: ["stack"]
    };

    for (const [zone, words] of Object.entries(zones)) {

      if (
        words.some(word => wordExists(q, word))
      ) {
        addUnique(
          intent.zones,
          zone
        );
      }
    }
  }


  // ============================================================
  // STRATEGIES
  // ============================================================

  function parseStrategies(q, intent) {

    const strategies = {
      ramp: ["ramp"],
      aggro: ["aggro", "aggressive", "beatdown"],
      control: ["control deck"],
      midrange: ["midrange"],
      aristocrats: ["aristocrats"],
      reanimator: ["reanimator"],
      tokens: ["token deck", "go wide"],
      spellslinger: ["spellslinger"],
      voltron: ["voltron"],
      tribal: ["tribal"],
      artifacts: ["artifact deck"],
      enchantments: ["enchantment deck", "enchantress"],
      lifegain: ["lifegain deck", "life gain deck"]
    };


    for (const [strategy, phrases] of Object.entries(strategies)) {

      if (
        phrases.some(
          phrase => q.includes(phrase)
        )
      ) {
        addUnique(
          intent.strategies,
          strategy
        );
      }
    }
  }


  // ============================================================
  // FORMATS
  // ============================================================

  function parseFormats(q, intent) {

    const formats = [
      "commander",
      "edh",
      "standard",
      "modern",
      "pioneer",
      "legacy",
      "vintage",
      "pauper",
      "historic",
      "timeless",
      "alchemy",
      "oathbreaker",
      "brawl"
    ];

    for (const format of formats) {

      if (wordExists(q, format)) {

        addUnique(
          intent.formats,
          format === "edh"
            ? "commander"
            : format
        );
      }
    }
  }


  // ============================================================
  // RARITY
  // ============================================================

  function parseRarity(q, intent) {

    for (const rarity of [
      "common",
      "uncommon",
      "rare",
      "mythic"
    ]) {

      if (wordExists(q, rarity)) {

        addUnique(
          intent.rarities,
          rarity
        );
      }
    }
  }


  // ============================================================
  // SETS
  // ============================================================

  function parseSets(q, intent) {

    const sets = {
      "lord of the rings": "ltr",
      "modern horizons 3": "mh3",
      "modern horizons 2": "mh2",
      "wilds of eldraine": "woe",
      "lost caverns of ixalan": "lci",
      "march of the machine": "mom",
      "phyrexia all will be one": "one",
      "dominaria united": "dmu",
      "kamigawa neon dynasty": "neo",
      "streets of new capenna": "snc",
      "zendikar rising": "znr"
    };


    for (const [name, code] of Object.entries(sets)) {

      if (q.includes(name)) {
        addUnique(
          intent.sets,
          code
        );
      }
    }
  }


  // ============================================================
  // REFERENCES
  // ============================================================

  function parseReferences(original, intent) {

    const patterns = [
      /similar to\s+(.+?)(?:\s+but|\s+that|\s+which|$)/i,
      /similar\s+to\s+(.+)$/i,
      /like\s+(.+?)(?:\s+but|\s+that|\s+which|$)/i
    ];


    for (const pattern of patterns) {

      const match =
        original.match(pattern);

      if (!match) continue;

      const reference =
        match[1]
          .replace(/[?.!,]+$/, "")
          .trim();

      if (reference) {

        addUnique(
          intent.references,
          reference
        );

        break;
      }
    }
  }


  // ============================================================
  // NEGATIONS
  // ============================================================

  function parseNegations(q, intent) {

    const patterns = [
      /not\s+([a-z]+)/g,
      /without\s+([a-z]+)/g
    ];


    for (const pattern of patterns) {

      let match;

      while ((match = pattern.exec(q))) {

        addUnique(
          intent.exclusions,
          match[1]
        );
      }
    }
  }


  // ============================================================
  // PREFERENCES
  // ============================================================

  function parsePreferences(q, intent) {

    if (
      q.includes("cheap") ||
      q.includes("efficient")
    ) {
      addUnique(
        intent.preferences,
        "low_cost"
      );
    }

    if (
      q.includes("powerful") ||
      q.includes("strong") ||
      q.includes("best")
    ) {
      addUnique(
        intent.preferences,
        "power"
      );
    }

    if (
      q.includes("value") ||
      q.includes("card advantage")
    ) {
      addUnique(
        intent.preferences,
        "value"
      );
    }

    if (
      q.includes("budget") ||
      q.includes("cheap to buy")
    ) {
      addUnique(
        intent.preferences,
        "budget"
      );
    }
  }


  // ============================================================
  // RETRIEVAL
  //
  // Retrieve broadly enough that local ranking can do its job.
  // ============================================================

  function buildRetrievalQuery(intent) {

    const parts = [];


    if (intent.colors.length) {

      parts.push(
        `c:${intent.colors.join("")}`
      );
    }


    if (intent.type) {

      parts.push(
        `t:${intent.type}`
      );
    }


    for (const subtype of intent.subtypes) {

      parts.push(
        `t:${subtype}`
      );
    }


    for (const supertype of intent.supertypes) {

      parts.push(
        `is:${supertype}`
      );
    }


    if (intent.mana_value.exact !== null) {

      parts.push(
        `mv:${intent.mana_value.exact}`
      );

    } else {

      if (intent.mana_value.min !== null) {
        parts.push(
          `mv>=${intent.mana_value.min}`
        );
      }

      if (intent.mana_value.max !== null) {
        parts.push(
          `mv<=${intent.mana_value.max}`
        );
      }
    }


    if (intent.formats.length) {

      parts.push(
        `f:${intent.formats[0]}`
      );
    }


    if (intent.rarities.length) {

      parts.push(
        `r:${intent.rarities[0]}`
      );
    }


    if (intent.sets.length) {

      parts.push(
        `set:${intent.sets[0]}`
      );
    }


    // Keywords are useful retrieval constraints.

    for (const keyword of intent.keywords) {

      parts.push(
        `o:"${keyword}"`
      );
    }


    /*
     * Concepts intentionally aren't all turned into hard
     * constraints. "Similar to Sorin" is the obvious example:
     *
     * retrieve candidates first, then rank them.
     */
    for (const concept of intent.concepts) {

      const oracle = {
        draw: "draw",
        mana: "mana",
        sacrifice: "sacrifice",
        graveyard: "graveyard",
        removal: "destroy",
        exile: "exile",
        damage: "damage",
        discard: "discard",
        counter: "counter",
        tokens: "token",
        lifegain: "gain life",
        tutor: "search your library",
        mill: "mill",
        blink: "exile",
        copy: "copy",
        counters: "counter",
        extra_land: "land",
        pump: "gets +"
      }[concept];

      if (oracle) {
        parts.push(`o:"${oracle}"`);
      }
    }


    /*
     * If we understood nothing, use the user's natural language
     * directly. Scryfall has a powerful search parser of its own.
     */
    if (!parts.length) {
      return intent.original_query;
    }


    return parts.join(" ");
  }


  // ============================================================
  // REFERENCE RESOLUTION
  // ============================================================

  async function resolveReferences(names) {

    const resolved = [];

    for (const name of names.slice(0, 3)) {

      try {

        const response = await fetch(
          "https://api.scryfall.com/cards/named?fuzzy=" +
          encodeURIComponent(name)
        );

        if (!response.ok) continue;

        const card = await response.json();

        resolved.push(card);

      } catch (error) {

        console.warn(
          "Could not resolve reference:",
          name
        );
      }
    }

    return resolved;
  }


  // ============================================================
  // MATCH SCORING
  //
  // Total = 0..100
  //
  // Hard requirements carry more weight.
  // Semantic similarity carries the rest.
  // ============================================================

  function scoreCard(card, intent, references) {

    let total = 0;

    const reasons = [];

    // ----------------------------------------------------------
    // TYPE
    // ----------------------------------------------------------

    if (intent.type) {

      if (
        card.type_line &&
        card.type_line
          .toLowerCase()
          .includes(intent.type)
      ) {

        total += 18;

        reasons.push(
          `Type: ${intent.type}`
        );
      }
    }


    // ----------------------------------------------------------
    // SUBTYPE
    // ----------------------------------------------------------

    if (intent.subtypes.length) {

      const line =
        (card.type_line || "")
          .toLowerCase();

      let matches = 0;

      for (const subtype of intent.subtypes) {

        if (line.includes(subtype)) {
          matches++;
        }
      }

      if (matches) {

        total +=
          20 *
          (matches / intent.subtypes.length);

        reasons.push(
          `Subtype: ${intent.subtypes.join(", ")}`
        );
      }
    }


    // ----------------------------------------------------------
    // COLORS
    // ----------------------------------------------------------

    if (intent.colors.length) {

      const cardColors =
        card.colors || [];

      const intersection =
        intent.colors.filter(
          c => cardColors.includes(c)
        );

      if (intersection.length) {

        total +=
          18 *
          (
            intersection.length /
            intent.colors.length
          );

        reasons.push(
          "Color identity"
        );
      }
    }


    // ----------------------------------------------------------
    // MANA
    // ----------------------------------------------------------

    if (
      intent.mana_value.max !== null ||
      intent.mana_value.min !== null ||
      intent.mana_value.exact !== null
    ) {

      const mv =
        card.cmc ?? 0;

      if (
        intent.mana_value.exact !== null &&
        mv === intent.mana_value.exact
      ) {

        total += 12;

        reasons.push(
          "Exact mana value"
        );

      } else {

        if (
          intent.mana_value.max !== null &&
          mv <= intent.mana_value.max
        ) {

          total += 10;

          reasons.push(
            "Low mana value"
          );
        }

        if (
          intent.mana_value.min !== null &&
          mv >= intent.mana_value.min
        ) {

          total += 10;

          reasons.push(
            "High mana value"
          );
        }
      }
    }


    // ----------------------------------------------------------
    // KEYWORDS
    // ----------------------------------------------------------

    if (intent.keywords.length) {

      const oracle =
        (card.oracle_text || "")
          .toLowerCase();

      let matches = 0;

      for (const keyword of intent.keywords) {

        if (oracle.includes(keyword)) {
          matches++;
        }
      }

      if (matches) {

        total +=
          12 *
          (
            matches /
            intent.keywords.length
          );

        reasons.push(
          `${matches} requested keyword${matches === 1 ? "" : "s"}`
        );
      }
    }


    // ----------------------------------------------------------
    // CONCEPTS
    // ----------------------------------------------------------

    if (intent.concepts.length) {

      let conceptMatches = 0;

      for (const concept of intent.concepts) {

        if (
          cardMatchesConcept(
            card,
            concept
          )
        ) {
          conceptMatches++;
        }
      }

      if (conceptMatches) {

        total +=
          15 *
          (
            conceptMatches /
            intent.concepts.length
          );

        reasons.push(
          `${conceptMatches} matching mechanic${conceptMatches === 1 ? "" : "s"}`
        );
      }
    }


    // ----------------------------------------------------------
    // REFERENCE SIMILARITY
    // ----------------------------------------------------------

    if (references.length) {

      const similarity =
        referenceSimilarity(
          card,
          references
        );

      total += similarity.score;

      if (similarity.score > 0) {

        reasons.push(
          `Similar to ${similarity.reference}`
        );
      }
    }


    // ----------------------------------------------------------
    // PREFERENCES
    // ----------------------------------------------------------

    if (
      intent.preferences.includes("low_cost")
    ) {

      if ((card.cmc ?? 0) <= 3) {
        total += 5;
        reasons.push("Efficient");
      }
    }


    if (
      intent.preferences.includes("power")
    ) {

      const oracle =
        (card.oracle_text || "")
          .toLowerCase();

      if (
        oracle.length > 50 ||
        (card.cmc ?? 0) >= 4
      ) {
        total += 3;
        reasons.push("Powerful effect");
      }
    }


    if (
      intent.preferences.includes("value")
    ) {

      const oracle =
        (card.oracle_text || "")
          .toLowerCase();

      if (
        oracle.includes("draw") ||
        oracle.includes("token") ||
        oracle.includes("return")
      ) {
        total += 5;
        reasons.push("Value engine");
      }
    }


    // ----------------------------------------------------------
    // PENALTIES
    // ----------------------------------------------------------

    if (intent.exclusions.length) {

      const text =
        (
          card.name +
          " " +
          card.type_line +
          " " +
          card.oracle_text
        ).toLowerCase();

      for (const exclusion of intent.exclusions) {

        if (text.includes(exclusion)) {
          total -= 20;
        }
      }
    }


    return {
      total: Math.max(
        0,
        Math.min(
          100,
          Math.round(total)
        )
      ),

      reasons
    };
  }


  // ============================================================
  // REFERENCE SIMILARITY
  //
  // This is deliberately interpretable.
  //
  // We compare:
  //
  // - colors
  // - type
  // - subtypes
  // - mana
  // - keywords
  // - Oracle concepts
  // ============================================================

  function referenceSimilarity(card, references) {

    let best = {
      score: 0,
      reference: ""
    };


    for (const reference of references) {

      let score = 0;


      // Colors

      const aColors =
        card.colors || [];

      const bColors =
        reference.colors || [];

      if (aColors.length && bColors.length) {

        const common =
          aColors.filter(
            color => bColors.includes(color)
          );

        if (common.length) {
          score += 5;
        }
      }


      // Type

      const aType =
        card.type_line || "";

      const bType =
        reference.type_line || "";

      const types = [
        "creature",
        "artifact",
        "enchantment",
        "planeswalker",
        "instant",
        "sorcery",
        "land"
      ];

      for (const type of types) {

        if (
          aType.toLowerCase().includes(type) &&
          bType.toLowerCase().includes(type)
        ) {

          score += 4;
          break;
        }
      }


      // Subtypes

      const aLine =
        aType.toLowerCase();

      const bLine =
        bType.toLowerCase();

      const commonSubtypes = [
        "vampire",
        "wizard",
        "elf",
        "human",
        "dragon",
        "zombie",
        "angel",
        "demon",
        "goblin",
        "warrior",
        "knight",
        "rogue",
        "cleric",
        "spirit",
        "merfolk"
      ];

      for (const subtype of commonSubtypes) {

        if (
          aLine.includes(subtype) &&
          bLine.includes(subtype)
        ) {
          score += 5;
        }
      }


      // Mana proximity

      if (
        typeof card.cmc === "number" &&
        typeof reference.cmc === "number"
      ) {

        const difference =
          Math.abs(
            card.cmc -
            reference.cmc
          );

        if (difference === 0) {
          score += 5;
        } else if (difference === 1) {
          score += 3;
        }
      }


      // Keywords / Oracle text

      const aText =
        (
          card.oracle_text || ""
        ).toLowerCase();

      const bText =
        (
          reference.oracle_text || ""
        ).toLowerCase();


      const semanticTerms = [
        "draw",
        "discard",
        "sacrifice",
        "destroy",
        "exile",
        "damage",
        "token",
        "graveyard",
        "return",
        "counter",
        "life",
        "search",
        "land",
        "creature",
        "planeswalker",
        "attack",
        "combat",
        "cast",
        "spell",
        "mana",
        "power",
        "toughness",
        "copy",
        "gain",
        "lose"
      ];


      let sharedConcepts = 0;

      for (const term of semanticTerms) {

        if (
          aText.includes(term) &&
          bText.includes(term)
        ) {
          sharedConcepts++;
        }
      }


      score += Math.min(
        12,
        sharedConcepts * 2
      );


      // Cap the contribution so "similar to" doesn't overpower
      // explicit user requirements.

      score = Math.min(
        25,
        score
      );


      if (score > best.score) {

        best = {
          score,
          reference: reference.name
        };
      }
    }


    return best;
  }


  // ============================================================
  // CARD RENDERING
  // ============================================================

  function renderCards() {

    results.innerHTML = cards
      .slice(0, 24)
      .map((card, index) => {

        const image =
          card.image_uris?.normal ||
          card.card_faces?.[0]?.image_uris?.normal;

        if (!image) return "";


        const match =
          card._match || {
            total: 0,
            reasons: []
          };


        const scoreColor =
          match.total >= 80
            ? "#67d391"
            : match.total >= 60
              ? "#d4af67"
              : match.total >= 40
                ? "#d69a58"
                : "#8f8b95";


        return `
          <article
            class="card"
            data-index="${index}"
            style="position:relative;"
          >

            <img
              src="${escapeHtml(image)}"
              alt="${escapeHtml(card.name)}"
              loading="lazy"
            >

            <div
              class="match-score"
              style="
                margin-top:8px;
                font-size:12px;
              "
            >

              <div style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                margin-bottom:4px;
              ">

                <span style="
                  color:#aaa7b0;
                  font-size:11px;
                ">
                  MATCH
                </span>

                <strong style="
                  color:${scoreColor};
                ">
                  ${match.total}%
                </strong>

              </div>

              <div style="
                width:100%;
                height:4px;
                background:#242229;
                border-radius:99px;
                overflow:hidden;
              ">

                <div style="
                  width:${match.total}%;
                  height:100%;
                  background:${scoreColor};
                  border-radius:99px;
                  transition:width .4s ease;
                "></div>

              </div>

            </div>


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

      card.addEventListener("click", () => {

        openCard(
          Number(card.dataset.index)
        );
      });
    });
  }


  // ============================================================
  // MODAL
  // ============================================================

  function openCard(index) {

    const card = cards[index];

    if (!card || !modal) return;

    const image =
      card.image_uris?.large ||
      card.card_faces?.[0]?.image_uris?.large;

    const modalImage =
      document.getElementById("modal-image");

    const modalDetails =
      document.getElementById("modal-details");


    if (modalImage) {

      modalImage.src = image;
      modalImage.alt = card.name;
    }


    if (modalDetails) {

      const match =
        card._match || {
          total: 0,
          reasons: []
        };


      modalDetails.innerHTML = `

        <h2>
          ${escapeHtml(card.name)}
        </h2>

        <div
          style="
            margin-bottom:18px;
            padding:12px;
            border-radius:10px;
            background:#111014;
            border:1px solid #302e35;
          "
        >

          <div style="
            display:flex;
            justify-content:space-between;
            margin-bottom:7px;
          ">

            <span style="color:#aaa7b0">
              Match score
            </span>

            <strong style="
              color:#d4af67;
            ">
              ${match.total}%
            </strong>

          </div>

          <div style="
            height:5px;
            background:#28252d;
            border-radius:99px;
            overflow:hidden;
          ">

            <div style="
              width:${match.total}%;
              height:100%;
              background:#d4af67;
            "></div>

          </div>

          ${
            match.reasons.length
              ? `
                <div style="
                  margin-top:10px;
                  color:#aaa7b0;
                  font-size:12px;
                  line-height:1.6;
                ">
                  ${match.reasons
                    .map(
                      reason =>
                        `<div>✓ ${escapeHtml(reason)}</div>`
                    )
                    .join("")}
                </div>
              `
              : ""
          }

        </div>


        <div class="detail-label">
          Mana
        </div>

        <div>
          ${escapeHtml(card.mana_cost || "—")}
        </div>


        <div class="detail-label">
          Type
        </div>

        <div>
          ${escapeHtml(card.type_line || "—")}
        </div>


        <div class="detail-label">
          Rules
        </div>

        <div>
          ${escapeHtml(card.oracle_text || "—")}
        </div>


        ${
          card.flavor_text
            ? `
              <div class="detail-label">
                Flavor
              </div>

              <div>
                <em>
                  ${escapeHtml(card.flavor_text)}
                </em>
              </div>
            `
            : ""
        }


        <div class="detail-label">
          Set
        </div>

        <div>
          ${escapeHtml(card.set_name || "—")}
        </div>


        <br>

        <a
          href="${escapeHtml(card.scryfall_uri)}"
          target="_blank"
          rel="noopener noreferrer"
          style="color:#d4af67"
        >
          View on Scryfall →
        </a>
      `;
    }


    modal.classList.remove("hidden");
  }


  // ============================================================
  // INTERPRETATION UI
  // ============================================================

  function showInterpretation(intent) {

    if (!interpretation) return;

    interpretation.innerHTML = `
      <details>
        <summary>
          Show interpretation
        </summary>

        <div style="
          margin-top:10px;
          padding:14px;
          border-radius:10px;
          background:#09090c;
          border:1px solid #302e35;
        ">

          <pre style="
            margin:0;
            white-space:pre-wrap;
            color:#aaa7b0;
            font-size:11px;
            line-height:1.5;
          ">${escapeHtml(
            JSON.stringify(intent, null, 2)
          )}</pre>

        </div>
      </details>
    `;
  }


  // ============================================================
  // UTILS
  // ============================================================

  function wordExists(text, word) {

    return new RegExp(
      `(^|\\s)${escapeRegex(word)}(?=\\s|$)`,
      "i"
    ).test(text);
  }


  function addUnique(array, value) {

    if (!array.includes(value)) {
      array.push(value);
    }
  }


  function normalize(text) {

    return text
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }


  function escapeRegex(value) {

    return String(value)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
