document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /*
   * MTG CARD LAB
   * ------------------------------------------------------------
   * Natural-language MTG search without an API key.
   *
   * Pipeline:
   *
   *   natural language
   *        ↓
   *   interpretQuery()
   *        ↓
   *   retrieveCandidates()
   *        ↓
   *   inferCardConcepts()
   *        ↓
   *   scoreCard()
   *        ↓
   *   ranked results
   *
   * Scryfall does the heavy lifting for card retrieval.
   * Everything after retrieval happens locally in the browser.
   */

  const API = "https://api.scryfall.com";

  // ------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------

  const queryInput =
    document.getElementById("query") ||
    document.getElementById("searchInput");

  const searchButton =
    document.getElementById("search") ||
    document.getElementById("searchButton");

  const randomButton =
    document.getElementById("random");

  const results =
    document.getElementById("results");

  const status =
    document.getElementById("status");

  const interpretation =
    document.getElementById("interpretation");

  const modal =
    document.getElementById("modal");

  const closeModal =
    document.getElementById("close");

  if (!queryInput || !searchButton || !results) {
    console.error(
      "MTG Card Lab: Could not find query/search/results elements."
    );
    return;
  }

  let currentCards = [];
  let currentCardIndex = -1;



  // ============================================================
  // SEARCH
  // ============================================================

  searchButton.addEventListener("click", runSearch);

  queryInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  });


  if (randomButton) {
    randomButton.addEventListener("click", () => {

      const examples = [
        "black creatures that come back from the graveyard",
        "blue cards that draw cards and counter spells",
        "cards like Lightning Bolt but cheaper",
        "red vampire creatures similar to Sorin",
        "cheap green creatures that make mana",
        "white creatures that make tokens",
        "creatures with flying and lifelink",
        "cards that sacrifice creatures for value",
        "cards that destroy artifacts and enchantments",
        "cards that let me play extra lands",
        "cheap creatures that have haste",
        "black cards that make opponents discard",
        "cards that copy spells",
        "graveyard cards for a commander deck",
        "red cards that deal damage when creatures die"
      ];

      queryInput.value =
        examples[
          Math.floor(Math.random() * examples.length)
        ];

      runSearch();
    });
  }


  // Existing example buttons, if present.
  document
    .querySelectorAll("[data-query]")
    .forEach(button => {

      button.addEventListener("click", () => {

        queryInput.value =
          button.dataset.query || "";

        runSearch();
      });
    });


  if (closeModal && modal) {

    closeModal.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    modal.addEventListener("click", event => {

      if (event.target === modal) {
        modal.classList.add("hidden");
      }
    });
  }

  // ============================================================
  // KEYBOARD CARD NAVIGATION
  // ============================================================

  document.addEventListener("keydown", event => {

    if (
      !modal ||
      modal.classList.contains("hidden")
    ) {
      return;
    }

    // Don't interfere with typing.
    if (
      event.target.matches(
        "input, textarea, select"
      ) ||
      event.target.isContentEditable
    ) {
      return;
    }

    // Escape closes the modal.
    if (event.key === "Escape") {

      event.preventDefault();

      modal.classList.add("hidden");

      return;
    }

    // Next card.
    if (event.key === "ArrowRight") {

      event.preventDefault();

      if (
        currentCardIndex <
        currentCards.length - 1
      ) {

        openCard(
          currentCardIndex + 1
        );
      }

      return;
    }

    // Previous card.
    if (event.key === "ArrowLeft") {

      event.preventDefault();

      if (currentCardIndex > 0) {

        openCard(
          currentCardIndex - 1
        );
      }

      return;
    }
  });



  // ============================================================
  // MAIN PIPELINE
  // ============================================================

  async function runSearch() {

    const query =
      queryInput.value.trim();

    if (!query) {
      queryInput.focus();
      return;
    }

    results.innerHTML = "";

    setStatus("Understanding your query…");

    const intent =
      interpretQuery(query);

    renderInterpretation(intent);

    try {

      setStatus("Finding cards…");

      const candidates =
        await retrieveCandidates(
          intent,
          query
        );

      if (!candidates.length) {

        setStatus("No matching cards found.");

        results.innerHTML = `
          <div class="empty">
            <p>No cards found.</p>
            <p>
              Try describing the effect differently,
              such as "creatures that return from the graveyard".
            </p>
          </div>
        `;

        return;
      }


      // Resolve reference cards such as "similar to Sorin".
      let references = [];

      if (intent.references.length) {

        setStatus("Resolving reference cards…");

        references =
          await resolveReferences(
            intent.references
          );
      }


      setStatus("Ranking cards…");


      currentCards =
        candidates
          .map(card => {

            const concepts =
              inferCardConcepts(card);

            const match =
              scoreCard(
                card,
                concepts,
                intent,
                references
              );

            return {
              ...card,
              _concepts: concepts,
              _match: match
            };
          })
          .sort(
            (a, b) =>
              b._match.total -
              a._match.total
          );


      setStatus(
        `${currentCards.length.toLocaleString()} cards ranked`
      );

      renderResults();

    } catch (error) {

      console.error(
        "MTG Card Lab search failed:",
        error
      );

      setStatus("Search failed.");

      results.innerHTML = `
        <div class="empty">
          <p>Something went wrong.</p>
          <p style="opacity:.65">
            Check the browser console for details.
          </p>
        </div>
      `;
    }
  }


  // ============================================================
  // SEMANTIC INTERPRETER
  // ============================================================

  function interpretQuery(input) {

    const text =
      normalize(input);

    const intent = {

      original: input,

      colors: [],

      cardTypes: [],

      subtypes: [],

      supertypes: [],

      keywords: [],

      concepts: [],

      zones: [],

      strategies: [],

      formats: [],

      references: [],

      exclusions: [],

      comparisons: [],

      mana: {
        min: null,
        max: null,
        exact: null
      },

      logic: "AND"
    };


    // ----------------------------------------------------------
    // COLORS
    // ----------------------------------------------------------

    const colorAliases = {

      white: "W",
      blue: "U",
      black: "B",
      red: "R",
      green: "G",
      colorless: "C",

      azorius: ["W", "U"],
      dimir: ["U", "B"],
      rakdos: ["B", "R"],
      gruul: ["R", "G"],
      selesnya: ["G", "W"],
      orzhov: ["W", "B"],
      izzet: ["U", "R"],
      golgari: ["B", "G"],
      simic: ["G", "U"],
      boros: ["R", "W"],

      bant: ["G", "W", "U"],
      esper: ["W", "U", "B"],
      grixis: ["U", "B", "R"],
      jund: ["B", "R", "G"],
      naya: ["R", "G", "W"],

      mardu: ["W", "B", "R"],
      temur: ["U", "R", "G"],
      abzan: ["W", "B", "G"],
      jeskai: ["W", "U", "R"],
      sultai: ["U", "B", "G"]
    };


    for (const [word, value] of Object.entries(
      colorAliases
    )) {

      if (hasWord(text, word)) {

        if (Array.isArray(value)) {

          value.forEach(color =>
            addUnique(
              intent.colors,
              color
            )
          );

        } else {

          addUnique(
            intent.colors,
            value
          );
        }
      }
    }


    // ----------------------------------------------------------
    // CARD TYPES
    // ----------------------------------------------------------

    const typeAliases = {

      creatures: "creature",
      creature: "creature",

      artifacts: "artifact",
      artifact: "artifact",

      enchantments: "enchantment",
      enchantment: "enchantment",

      planeswalkers: "planeswalker",
      planeswalker: "planeswalker",

      instants: "instant",
      instant: "instant",

      sorceries: "sorcery",
      sorcery: "sorcery",

      lands: "land",
      land: "land",

      battles: "battle",
      battle: "battle"
    };


    for (const [word, type] of Object.entries(
      typeAliases
    )) {

      if (hasWord(text, word)) {

        addUnique(
          intent.cardTypes,
          type
        );
      }
    }


    // ----------------------------------------------------------
    // TRIBES / SUBTYPES
    // ----------------------------------------------------------

    const tribes = [
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


    for (const tribe of tribes) {

      if (hasWord(text, tribe)) {

        addUnique(
          intent.subtypes,
          tribe
        );
      }
    }


    // ----------------------------------------------------------
    // SUPERTYPES
    // ----------------------------------------------------------

    [
      "legendary",
      "basic",
      "snow"
    ].forEach(value => {

      if (hasWord(text, value)) {

        addUnique(
          intent.supertypes,
          value
        );
      }
    });


    // ----------------------------------------------------------
    // KEYWORDS
    // ----------------------------------------------------------

    const keywordAliases = {

      "first strike": "first strike",
      "double strike": "double strike",
      flying: "flying",
      haste: "haste",
      trample: "trample",
      deathtouch: "deathtouch",
      lifelink: "lifelink",
      menace: "menace",
      vigilance: "vigilance",
      flash: "flash",
      defender: "defender",
      hexproof: "hexproof",
      indestructible: "indestructible",
      ward: "ward",
      prowess: "prowess",
      reach: "reach",
      toxic: "toxic",
      infect: "infect",
      cascade: "cascade",
      convoke: "convoke",
      delve: "delve",
      cycling: "cycling",
      kicker: "kicker",
      madness: "madness",
      morph: "morph",
      scry: "scry",
      surveil: "surveil",
      investigate: "investigate",
      connive: "connive",
      proliferate: "proliferate",
      landfall: "landfall",
      devotion: "devotion",
      mutate: "mutate",
      escape: "escape",
      flashback: "flashback",
      foretell: "foretell",
      incubate: "incubate"
    };


    for (const [phrase, keyword] of Object.entries(
      keywordAliases
    )) {

      if (text.includes(phrase)) {

        addUnique(
          intent.keywords,
          keyword
        );
      }
    }


    // ----------------------------------------------------------
    // SEMANTIC CONCEPTS
    //
    // Each concept has MANY natural-language expressions.
    // ----------------------------------------------------------

    const conceptPatterns = {

      card_draw: [
        "draw a card",
        "draw cards",
        "draw more",
        "card draw",
        "card advantage",
        "cantrip",
        "refill my hand",
        "draw from your library"
      ],

      mana_ramp: [
        "ramp",
        "make mana",
        "makes mana",
        "generate mana",
        "generates mana",
        "produce mana",
        "produces mana",
        "mana acceleration",
        "mana dork",
        "mana dorks",
        "add mana"
      ],

      graveyard_recursion: [
        "come back from the graveyard",
        "comes back from the graveyard",
        "return from the graveyard",
        "returns from the graveyard",
        "return it from the graveyard",
        "bring it back from the graveyard",
        "bring back from the graveyard",
        "recur",
        "recursion",
        "recurring",
        "reanimate",
        "reanimation",
        "return from your graveyard"
      ],

      sacrifice: [
        "sacrifice",
        "sacrificing",
        "sac outlet",
        "sacrifice outlet",
        "sacrifice creatures"
      ],

      creature_removal: [
        "creature removal",
        "remove creatures",
        "kill creatures",
        "kills creatures",
        "destroy creatures",
        "destroy target creature",
        "destroy a creature",
        "exile creatures",
        "exile target creature"
      ],

      artifact_removal: [
        "destroy artifacts",
        "destroy target artifact",
        "artifact removal",
        "remove artifacts"
      ],

      enchantment_removal: [
        "destroy enchantments",
        "destroy target enchantment",
        "enchantment removal",
        "remove enchantments"
      ],

      direct_damage: [
        "deal damage",
        "deals damage",
        "direct damage",
        "burn",
        "burn spells",
        "damage to any target",
        "damage to target",
        "damage an opponent"
      ],

      discard: [
        "discard",
        "discards",
        "discard cards",
        "discard a card",
        "discard their hand",
        "hand disruption"
      ],

      counterspell: [
        "counter spells",
        "counter a spell",
        "counter target spell",
        "counterspell",
        "counter magic",
        "countering spells"
      ],

      token_generation: [
        "make tokens",
        "makes tokens",
        "create tokens",
        "creates tokens",
        "token generation",
        "token maker",
        "token maker",
        "go wide"
      ],

      lifegain: [
        "gain life",
        "gains life",
        "life gain",
        "lifegain",
        "gain a lot of life"
      ],

      tutoring: [
        "tutor",
        "tutors",
        "search your library",
        "search the library",
        "find a card from your library"
      ],

      mill: [
        "mill",
        "mills",
        "mill cards",
        "put cards from the top of the library into the graveyard"
      ],

      blink: [
        "blink",
        "flicker",
        "exile and return",
        "exile it and return",
        "exile a creature then return"
      ],

      copy: [
        "copy a spell",
        "copy spells",
        "copy creatures",
        "copy a creature",
        "clone",
        "copies another"
      ],

      counters: [
        "+1/+1 counters",
        "plus one plus one counters",
        "plus one counters",
        "put counters",
        "puts counters",
        "counter distribution"
      ],

      extra_lands: [
        "play extra lands",
        "play additional lands",
        "extra land",
        "additional land",
        "play more lands"
      ],

      creature_pump: [
        "pump creatures",
        "buff creatures",
        "make creatures bigger",
        "creatures get bigger",
        "give creatures +",
        "anthem"
      ],

      life_loss: [
        "lose life",
        "loses life",
        "life loss",
        "drain life"
      ],

      theft: [
        "steal a creature",
        "gain control of",
        "take control of",
        "creature theft",
        "steal creatures"
      ],

      combat: [
        "combat",
        "attack",
        "attacking",
        "attacks",
        "block",
        "blocking"
      ],

      cast_from_graveyard: [
        "cast from the graveyard",
        "cast cards from the graveyard",
        "cast from your graveyard"
      ],

      cast_from_exile: [
        "cast from exile",
        "cast cards from exile"
      ],

      landfall: [
        "landfall",
        "whenever a land enters",
        "when a land enters"
      ],

      death_trigger: [
        "when it dies",
        "when this creature dies",
        "dies",
        "death trigger",
        "creature dies"
      ],

      enter_battlefield: [
        "enters the battlefield",
        "enter the battlefield",
        "enters play",
        "when this enters"
      ],

      cast_trigger: [
        "when you cast",
        "whenever you cast",
        "cast trigger"
      ]
    };


    for (
      const [concept, patterns]
      of Object.entries(conceptPatterns)
    ) {

      if (
        patterns.some(
          phrase => text.includes(phrase)
        )
      ) {

        addUnique(
          intent.concepts,
          concept
        );
      }
    }


    // ----------------------------------------------------------
    // ZONES
    // ----------------------------------------------------------

    const zonePatterns = {

      graveyard: [
        "graveyard",
        "graveyards",
        "from the graveyard"
      ],

      hand: [
        "hand",
        "from your hand"
      ],

      library: [
        "library",
        "deck"
      ],

      battlefield: [
        "battlefield",
        "in play"
      ],

      exile: [
        "exile",
        "exiled"
      ],

      stack: [
        "stack"
      ]
    };


    for (
      const [zone, patterns]
      of Object.entries(zonePatterns)
    ) {

      if (
        patterns.some(
          phrase => text.includes(phrase)
        )
      ) {

        addUnique(
          intent.zones,
          zone
        );
      }
    }


    // ----------------------------------------------------------
    // STRATEGIES
    // ----------------------------------------------------------

    const strategies = {

      aristocrats: [
        "aristocrats",
        "death trigger sacrifice deck",
        "sacrifice deck"
      ],

      reanimator: [
        "reanimator",
        "reanimation deck"
      ],

      spellslinger: [
        "spellslinger",
        "spell deck"
      ],

      tokens: [
        "token deck",
        "go wide"
      ],

      voltron: [
        "voltron"
      ],

      tribal: [
        "tribal"
      ],

      aggro: [
        "aggro",
        "aggressive deck",
        "beatdown"
      ],

      control: [
        "control deck"
      ],

      midrange: [
        "midrange deck"
      ],

      enchantress: [
        "enchantress",
        "enchantment deck"
      ],

      artifacts: [
        "artifact deck"
      ],

      lifegain: [
        "lifegain deck",
        "life gain deck"
      ]
    };


    for (
      const [strategy, patterns]
      of Object.entries(strategies)
    ) {

      if (
        patterns.some(
          phrase => text.includes(phrase)
        )
      ) {

        addUnique(
          intent.strategies,
          strategy
        );
      }
    }


    // ----------------------------------------------------------
    // FORMATS
    // ----------------------------------------------------------

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
      "brawl",
      "oathbreaker"
    ];


    formats.forEach(format => {

      if (hasWord(text, format)) {

        addUnique(
          intent.formats,
          format === "edh"
            ? "commander"
            : format
        );
      }
    });


    // ----------------------------------------------------------
    // MANA
    // ------------------------------------------------------------

    parseManaIntent(text, intent);


    // ----------------------------------------------------------
    // REFERENCES
    // ------------------------------------------------------------

    parseReferences(input, intent);


    // ----------------------------------------------------------
    // COMPARISONS
    // ------------------------------------------------------------

    if (
      /\bcheaper\b|\blower cost\b|\blower mana\b|\bless mana\b/.test(text)
    ) {

      addUnique(
        intent.comparisons,
        "lower_mana"
      );
    }


    if (
      /\bmore expensive\b|\bhigher cost\b|\bmore mana\b/.test(text)
    ) {

      addUnique(
        intent.comparisons,
        "higher_mana"
      );
    }


    // ----------------------------------------------------------
    // EXCLUSIONS
    // ----------------------------------------------------------

    const exclusionPatterns = [
      /without\s+([a-z][a-z -]*)/gi,
      /not\s+([a-z][a-z -]*)/gi,
      /no\s+([a-z][a-z -]*)/gi
    ];


    for (
      const pattern of exclusionPatterns
    ) {

      let match;

      while (
        (match = pattern.exec(input))
      ) {

        const value =
          normalize(match[1])
            .replace(
              /\b(cards?|creatures?|spells?)\b/g,
              ""
            )
            .trim();

        if (value) {
          addUnique(
            intent.exclusions,
            value
          );
        }
      }
    }


    return intent;
  }


  // ============================================================
  // MANA PARSER
  // ============================================================

  function parseManaIntent(text, intent) {

    if (
      /\bcheap\b/.test(text) ||
      /\blow[- ]cost\b/.test(text) ||
      /\befficient\b/.test(text)
    ) {

      intent.mana.max = 3;
    }


    if (
      /\bexpensive\b/.test(text) ||
      /\bhigh[- ]cost\b/.test(text)
    ) {

      intent.mana.min = 5;
    }


    let match =
      text.match(
        /(?:mana value|mv)\s*(?:of|is|=)?\s*(\d+)/
      );

    if (match) {

      intent.mana.exact =
        Number(match[1]);
    }


    match =
      text.match(
        /(?:under|below|less than|at most|up to)\s+(\d+)\s*(?:mana|mv|mana value)?/
      );

    if (match) {

      intent.mana.max =
        Number(match[1]);
    }


    match =
      text.match(
        /(?:over|above|more than|at least)\s+(\d+)\s*(?:mana|mv|mana value)?/
      );

    if (match) {

      intent.mana.min =
        Number(match[1]);
    }
  }


  // ============================================================
  // REFERENCE PARSER
  // ============================================================

  function parseReferences(input, intent) {

    const patterns = [

      /(?:similar to|similar with|like|resembling)\s+(.+?)(?:\s+but\s+|\s+that\s+|\s+which\s+|$)/i,

      /(?:cards? similar to)\s+(.+)$/i,

      /(?:cards? like)\s+(.+)$/i
    ];


    for (
      const pattern of patterns
    ) {

      const match =
        input.match(pattern);

      if (!match) continue;


      let reference =
        match[1]
          .replace(/[?.!,]+$/, "")
          .trim();


      // Remove trailing natural-language comparison clauses.
      reference =
        reference
          .replace(
            /\s+(but cheaper|but stronger|but bigger|but faster)$/i,
            ""
          )
          .trim();


      if (reference) {

        // Avoid accidentally treating the entire query as a
        // reference when it clearly contains no card-like name.
        const words =
          reference.split(/\s+/);

        if (words.length <= 8) {

          addUnique(
            intent.references,
            reference
          );
        }
      }


      break;
    }
  }


  // ============================================================
  // RETRIEVAL
  //
  // Important:
  // We do NOT convert every semantic concept into o:"..."
  // because that caused the previous version to produce
  // brittle/invalid searches.
  //
  // Retrieval is deliberately broad.
  // Ranking happens locally.
  // ============================================================

  async function retrieveCandidates(
    intent,
    originalQuery
  ) {

    const queries = [];


    // ----------------------------------------------------------
    // Query 1: hard structural requirements
    // ----------------------------------------------------------

    const structural = [];


    if (intent.colors.length) {

      // Scryfall's color filter accepts combinations.
      structural.push(
        `c:${intent.colors.join("")}`
      );
    }


    if (intent.cardTypes.length) {

      // Multiple types are OR-ish possibilities for retrieval.
      structural.push(
        intent.cardTypes.length === 1
          ? `t:${intent.cardTypes[0]}`
          : `(${intent.cardTypes
              .map(type => `t:${type}`)
              .join(" OR ")})`
      );
    }


    if (intent.subtypes.length) {

      for (
        const subtype of intent.subtypes
      ) {

        structural.push(
          `t:${subtype}`
        );
      }
    }


    if (
      intent.mana.exact !== null
    ) {

      structural.push(
        `mv:${intent.mana.exact}`
      );

    } else {

      if (intent.mana.min !== null) {

        structural.push(
          `mv>=${intent.mana.min}`
        );
      }

      if (intent.mana.max !== null) {

        structural.push(
          `mv<=${intent.mana.max}`
        );
      }
    }


    if (intent.formats.length) {

      structural.push(
        `f:${intent.formats[0]}`
      );
    }


    if (structural.length) {

      queries.push(
        structural.join(" ")
      );
    }


    // ----------------------------------------------------------
    // Query 2: semantic text retrieval
    //
    // Scryfall handles natural language surprisingly well.
    // Use the original query as a fallback candidate source.
    // ----------------------------------------------------------

    queries.push(
      originalQuery
    );


    // ----------------------------------------------------------
    // Query 3: concepts represented as broad Oracle terms.
    //
    // This is deliberately OR-ish.
    // ----------------------------------------------------------

    const oracleTerms =
      conceptOracleTerms(
        intent.concepts
      );


    if (oracleTerms.length) {

      const oracleQuery =
        oracleTerms
          .slice(0, 5)
          .map(
            term => `o:"${term}"`
          )
          .join(" OR ");


      if (intent.colors.length) {

        queries.push(
          `c:${intent.colors.join("")} (${oracleQuery})`
        );

      } else {

        queries.push(
          oracleQuery
        );
      }
    }


    // ----------------------------------------------------------
    // Reference searches
    // ----------------------------------------------------------

    for (
      const reference of intent.references
    ) {

      queries.push(
        `name:${quoteScryfallName(reference)}`
      );
    }


    // ----------------------------------------------------------
    // Execute queries.
    // ----------------------------------------------------------

    const all =
      new Map();


    for (
      const query of queries.slice(0, 4)
    ) {

      if (!query.trim()) continue;


      try {

        const cards =
          await scryfallSearch(query);


        for (
          const card of cards
        ) {

          all.set(
            card.id,
            card
          );
        }

      } catch (error) {

        console.warn(
          "Retrieval query failed:",
          query,
          error
        );

        // Continue with other retrieval strategies.
      }
    }


    /*
     * If structural retrieval somehow returned nothing,
     * make one very broad fallback query.
     */
    if (!all.size) {

      try {

        const fallback =
          await scryfallSearch(
            "game:paper"
          );

        for (
          const card of fallback
        ) {

          all.set(
            card.id,
            card
          );
        }

      } catch (error) {

        console.error(
          "Fallback retrieval failed:",
          error
        );
      }
    }


    return [...all.values()];
  }


  function conceptOracleTerms(concepts) {

    const terms = [];


    const mapping = {

      card_draw: [
        "draw"
      ],

      mana_ramp: [
        "add {",
        "search your library for a basic land"
      ],

      graveyard_recursion: [
        "return",
        "graveyard"
      ],

      sacrifice: [
        "sacrifice"
      ],

      creature_removal: [
        "destroy",
        "exile"
      ],

      artifact_removal: [
        "artifact",
        "destroy"
      ],

      enchantment_removal: [
        "enchantment",
        "destroy"
      ],

      direct_damage: [
        "damage"
      ],

      discard: [
        "discard"
      ],

      counterspell: [
        "counter target"
      ],

      token_generation: [
        "create",
        "token"
      ],

      lifegain: [
        "gain life"
      ],

      tutoring: [
        "search your library"
      ],

      mill: [
        "mill"
      ],

      blink: [
        "exile",
        "return"
      ],

      copy: [
        "copy"
      ],

      counters: [
        "+1/+1"
      ],

      extra_lands: [
        "additional land"
      ],

      creature_pump: [
        "gets +"
      ],

      life_loss: [
        "lose life"
      ],

      theft: [
        "gain control"
      ],

      death_trigger: [
        "dies"
      ],

      enter_battlefield: [
        "enters the battlefield"
      ],

      cast_trigger: [
        "cast"
      ]
    };


    for (
      const concept of concepts
    ) {

      const values =
        mapping[concept] || [];

      values.forEach(
        value => addUnique(
          terms,
          value
        )
      );
    }


    return terms;
  }


  // ============================================================
  // SCRYFALL SEARCH
  // ============================================================

  async function scryfallSearch(query) {

    const url =
      `${API}/cards/search?q=${encodeURIComponent(query)}`;

    const response =
      await fetch(
        url,
        {
          headers: {
            "Accept":
              "application/json"
          }
        }
      );


    if (
      response.status === 404
    ) {

      return [];
    }


    if (!response.ok) {

      throw new Error(
        `Scryfall returned HTTP ${response.status}`
      );
    }


    const data =
      await response.json();


    let cards =
      data.data || [];


    /*
     * Follow a small number of pagination pages.
     *
     * This makes broad searches substantially better without
     * turning the demo into a huge crawler.
     */
    let next =
      data.has_more
        ? data.next_page
        : null;


    let pages = 0;


    while (
      next &&
      pages < 2
    ) {

      const nextResponse =
        await fetch(next);


      if (!nextResponse.ok) break;


      const nextData =
        await nextResponse.json();


      cards =
        cards.concat(
          nextData.data || []
        );


      next =
        nextData.has_more
          ? nextData.next_page
          : null;


      pages++;
    }


    return cards;
  }


  // ============================================================
  // REFERENCES
  // ============================================================

  async function resolveReferences(
    references
  ) {

    const resolved = [];


    for (
      const reference of references.slice(0, 3)
    ) {

      try {

        const response =
          await fetch(
            `${API}/cards/named?fuzzy=${encodeURIComponent(reference)}`
          );


        if (!response.ok) continue;


        const card =
          await response.json();


        resolved.push(card);

      } catch (error) {

        console.warn(
          "Reference resolution failed:",
          reference
        );
      }
    }


    return resolved;
  }


  // ============================================================
  // CARD CONCEPT EXTRACTION
  //
  // This is the key to semantic ranking.
  //
  // We don't need an embedding model for the first version.
  // We recognize common MTG mechanics from Oracle text.
  // ============================================================

  function inferCardConcepts(card) {

    const text =
      normalize(
        [
          card.name,
          card.type_line,
          card.oracle_text,
          card.flavor_text
        ]
          .filter(Boolean)
          .join(" ")
      );


    const concepts = new Set();


    const rules = {

      card_draw: [
        /\bdraw\b.*\bcard/,
        /\bdraws?\b.*\bcards?/,
        /\bdraw a card\b/
      ],

      mana_ramp: [
        /\badd\s+\{[wubrgc]/,
        /\bsearch your library for a .*land/,
        /\bput .* land .* onto the battlefield/
      ],

      graveyard_recursion: [
        /\breturn\b.*\bfrom (?:your )?graveyard/,
        /\breturn\b.*\bto the battlefield/,
        /\bgraveyard\b.*\bto the battlefield/,
        /\bput\b.*\bfrom .*graveyard\b.*\bbattlefield/
      ],

      sacrifice: [
        /\bsacrifice\b/
      ],

      creature_removal: [
        /\bdestroy\b.*\bcreature/,
        /\bexile\b.*\bcreature/,
        /\bcreature\b.*\bgets -/,
        /\btarget creature\b/
      ],

      artifact_removal: [
        /\bdestroy\b.*\bartifact/,
        /\bexile\b.*\bartifact/
      ],

      enchantment_removal: [
        /\bdestroy\b.*\benchantment/,
        /\bexile\b.*\benchantment/
      ],

      direct_damage: [
        /\bdeal\b.*\bdamage/,
        /\bdeals\b.*\bdamage/,
        /\bdamage\b.*\btarget/
      ],

      discard: [
        /\bdiscard\b/
      ],

      counterspell: [
        /\bcounter target\b/,
        /\bcounter\b.*\bspell/
      ],

      token_generation: [
        /\bcreate\b.*\btoken/,
        /\bcreates\b.*\btoken/,
        /\btoken\b.*\bcreature/
      ],

      lifegain: [
        /\bgain\b.*\blife/,
        /\bgains\b.*\blife/
      ],

      tutoring: [
        /\bsearch your library\b/
      ],

      mill: [
        /\bmill\b/
      ],

      blink: [
        /\bexile\b.*\breturn\b/,
        /\breturn\b.*\bexile\b/
      ],

      copy: [
        /\bcopy\b/
      ],

      counters: [
        /\+1\/\+1 counter/,
        /\bput\b.*\bcounter\b/
      ],

      extra_lands: [
        /\bplay an additional land/,
        /\bplay additional lands/,
        /\bplay one additional land/
      ],

      creature_pump: [
        /\bcreatures you control get\b/,
        /\bgets \+\d+\/\+\d+/,
        /\bget \+\d+\/\+\d+/
      ],

      life_loss: [
        /\bloses?\s+life\b/,
        /\blife loss\b/
      ],

      theft: [
        /\bgain control of\b/
      ],

      death_trigger: [
        /\bwhen .* dies\b/,
        /\bwhenever .* dies\b/
      ],

      enter_battlefield: [
        /\bwhen .* enters the battlefield\b/,
        /\bwhenever .* enters the battlefield\b/
      ],

      cast_trigger: [
        /\bwhen you cast\b/,
        /\bwhenever you cast\b/
      ],

      attack_trigger: [
        /\bwhen .* attacks\b/,
        /\bwhenever .* attacks\b/
      ]
    };


    for (
      const [concept, patterns]
      of Object.entries(rules)
    ) {

      if (
        patterns.some(
          pattern => pattern.test(text)
        )
      ) {

        concepts.add(concept);
      }
    }


    // Keywords become concepts too.

    const keywordList = [
      "flying",
      "haste",
      "trample",
      "deathtouch",
      "lifelink",
      "menace",
      "vigilance",
      "flash",
      "hexproof",
      "indestructible",
      "ward",
      "prowess",
      "first strike",
      "double strike",
      "reach",
      "toxic",
      "infect",
      "cascade",
      "cycling",
      "kicker",
      "madness",
      "flashback",
      "foretell",
      "landfall",
      "proliferate",
      "connive",
      "investigate"
    ];


    for (
      const keyword of keywordList
    ) {

      if (
        text.includes(keyword)
      ) {

        concepts.add(
          `keyword:${keyword}`
        );
      }
    }


    return [
      ...concepts
    ];
  }


  // ============================================================
  // SCORING
  // ============================================================

  function scoreCard(
    card,
    cardConcepts,
    intent,
    references
  ) {

    let score = 0;

    const reasons = [];


    // ----------------------------------------------------------
    // TYPE
    // ----------------------------------------------------------

    if (intent.cardTypes.length) {

      const typeLine =
        normalize(
          card.type_line || ""
        );


      const matches =
        intent.cardTypes.filter(
          type =>
            typeLine.includes(type)
        );


      if (matches.length) {

        score +=
          20 *
          (
            matches.length /
            intent.cardTypes.length
          );

        reasons.push(
          `Type: ${matches.join(", ")}`
        );
      }
    }


    // ----------------------------------------------------------
    // SUBTYPE
    // ----------------------------------------------------------

    if (intent.subtypes.length) {

      const typeLine =
        normalize(
          card.type_line || ""
        );


      const matches =
        intent.subtypes.filter(
          subtype =>
            typeLine.includes(subtype)
        );


      if (matches.length) {

        score +=
          20 *
          (
            matches.length /
            intent.subtypes.length
          );

        reasons.push(
          `Tribe: ${matches.join(", ")}`
        );
      }
    }


    // ----------------------------------------------------------
    // COLORS
    // ----------------------------------------------------------

    if (intent.colors.length) {

      const cardColors =
        card.colors || [];


      const matches =
        intent.colors.filter(
          color =>
            cardColors.includes(color)
        );


      if (matches.length) {

        score +=
          15 *
          (
            matches.length /
            intent.colors.length
          );

        reasons.push(
          "Color match"
        );
      }
    }


    // ----------------------------------------------------------
    // MANA
    // ----------------------------------------------------------

    if (
      intent.mana.exact !== null ||
      intent.mana.min !== null ||
      intent.mana.max !== null
    ) {

      const mana =
        Number(card.cmc ?? 0);


      if (
        intent.mana.exact !== null
      ) {

        if (
          mana ===
          intent.mana.exact
        ) {

          score += 12;

          reasons.push(
            "Exact mana value"
          );
        }

      } else {

        let matched = false;


        if (
          intent.mana.max !== null &&
          mana <= intent.mana.max
        ) {

          score += 10;
          matched = true;

          reasons.push(
            "Low mana value"
          );
        }


        if (
          intent.mana.min !== null &&
          mana >= intent.mana.min
        ) {

          score += 10;
          matched = true;

          reasons.push(
            "Mana value matches"
          );
        }
      }
    }


    // ----------------------------------------------------------
    // KEYWORDS
    // ----------------------------------------------------------

    if (intent.keywords.length) {

      let matched = 0;

      const oracle =
        normalize(
          card.oracle_text || ""
        );


      for (
        const keyword of intent.keywords
      ) {

        if (
          oracle.includes(keyword)
        ) {

          matched++;
        }
      }


      if (matched) {

        score +=
          15 *
          (
            matched /
            intent.keywords.length
          );

        reasons.push(
          `${matched} keyword${matched === 1 ? "" : "s"}`
        );
      }
    }


    // ----------------------------------------------------------
    // CONCEPTS
    // ----------------------------------------------------------

    if (intent.concepts.length) {

      const matches =
        intent.concepts.filter(
          concept =>
            cardConcepts.includes(
              concept
            )
        );


      if (matches.length) {

        score +=
          25 *
          (
            matches.length /
            intent.concepts.length
          );


        reasons.push(
          `${matches.length} matching mechanic${matches.length === 1 ? "" : "s"}`
        );
      }
    }


    // ----------------------------------------------------------
    // ZONES
    // ----------------------------------------------------------

    if (intent.zones.length) {

      const cardText =
        normalize(
          card.oracle_text || ""
        );


      const zoneMatches =
        intent.zones.filter(
          zone =>
            cardText.includes(zone)
        );


      if (zoneMatches.length) {

        score +=
          8 *
          (
            zoneMatches.length /
            intent.zones.length
          );

        reasons.push(
          `Zone: ${zoneMatches.join(", ")}`
        );
      }
    }


    // ----------------------------------------------------------
    // STRATEGY
    // ----------------------------------------------------------

    if (intent.strategies.length) {

      const strategyScore =
        scoreStrategies(
          card,
          cardConcepts,
          intent.strategies
        );


      if (strategyScore > 0) {

        score += strategyScore;

        reasons.push(
          "Strategy synergy"
        );
      }
    }


    // ----------------------------------------------------------
    // REFERENCE SIMILARITY
    // ----------------------------------------------------------

    if (references.length) {

      const reference =
        findBestReferenceMatch(
          card,
          cardConcepts,
          references
        );


      if (reference.score > 0) {

        score += reference.score;

        reasons.push(
          `Similar to ${reference.name}`
        );
      }
    }


    // ----------------------------------------------------------
    // EXCLUSIONS
    // ----------------------------------------------------------

    if (intent.exclusions.length) {

      const text =
        normalize(
          [
            card.name,
            card.type_line,
            card.oracle_text
          ]
            .filter(Boolean)
            .join(" ")
        );


      for (
        const exclusion of intent.exclusions
      ) {

        if (
          text.includes(exclusion)
        ) {

          score -= 25;

          reasons.push(
            `Excluded: ${exclusion}`
          );
        }
      }
    }


    // ----------------------------------------------------------
    // SOFT BONUSES
    // ----------------------------------------------------------

    const original =
      normalize(
        intent.original
      );


    if (
      original.includes("cheap") ||
      original.includes("efficient")
    ) {

      if (
        Number(card.cmc ?? 0) <= 3
      ) {

        score += 5;

        reasons.push(
          "Efficient"
        );
      }
    }


    if (
      original.includes("powerful") ||
      original.includes("strong")
    ) {

      if (
        (card.oracle_text || "").length > 60
      ) {

        score += 3;
      }
    }


    // ----------------------------------------------------------
    // Final score
    // ----------------------------------------------------------

    return {

      total: Math.max(
        0,
        Math.min(
          100,
          Math.round(score)
        )
      ),

      reasons:
        [...new Set(reasons)]
          .slice(0, 6)
    };
  }


  // ============================================================
  // STRATEGY SCORING
  // ============================================================

  function scoreStrategies(
    card,
    concepts,
    strategies
  ) {

    let score = 0;

    const conceptSet =
      new Set(concepts);


    for (
      const strategy of strategies
    ) {

      if (
        strategy === "aristocrats" &&
        (
          conceptSet.has("sacrifice") ||
          conceptSet.has("death_trigger") ||
          conceptSet.has("graveyard_recursion")
        )
      ) {

        score += 8;
      }


      if (
        strategy === "reanimator" &&
        conceptSet.has(
          "graveyard_recursion"
        )
      ) {

        score += 8;
      }


      if (
        strategy === "spellslinger" &&
        (
          conceptSet.has("card_draw") ||
          conceptSet.has("counterspell") ||
          conceptSet.has("direct_damage")
        )
      ) {

        score += 6;
      }


      if (
        strategy === "tokens" &&
        conceptSet.has(
          "token_generation"
        )
      ) {

        score += 8;
      }


      if (
        strategy === "lifegain" &&
        conceptSet.has(
          "lifegain"
        )
      ) {

        score += 8;
      }


      if (
        strategy === "artifacts" &&
        normalize(
          card.type_line || ""
        ).includes("artifact")
      ) {

        score += 6;
      }


      if (
        strategy === "enchantress" &&
        normalize(
          card.type_line || ""
        ).includes("enchantment")
      ) {

        score += 6;
      }
    }


    return Math.min(
      12,
      score
    );
  }


  // ============================================================
  // REFERENCE SIMILARITY
  // ============================================================

  function findBestReferenceMatch(
    card,
    concepts,
    references
  ) {

    let best = {
      score: 0,
      name: ""
    };


    for (
      const reference of references
    ) {

      let score = 0;


      // Same color

      const cardColors =
        card.colors || [];

      const referenceColors =
        reference.colors || [];


      if (
        cardColors.length &&
        referenceColors.length &&
        cardColors.some(
          color =>
            referenceColors.includes(
              color
            )
        )
      ) {

        score += 4;
      }


      // Same broad type

      const cardType =
        normalize(
          card.type_line || ""
        );

      const referenceType =
        normalize(
          reference.type_line || ""
        );


      const broadTypes = [
        "creature",
        "artifact",
        "enchantment",
        "planeswalker",
        "instant",
        "sorcery",
        "land"
      ];


      for (
        const type of broadTypes
      ) {

        if (
          cardType.includes(type) &&
          referenceType.includes(type)
        ) {

          score += 5;
          break;
        }
      }


      // Same tribe

      const tribes = [
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


      for (
        const tribe of tribes
      ) {

        if (
          cardType.includes(tribe) &&
          referenceType.includes(tribe)
        ) {

          score += 6;
        }
      }


      // Mana proximity

      const a =
        Number(card.cmc ?? 0);

      const b =
        Number(reference.cmc ?? 0);


      const difference =
        Math.abs(a - b);


      if (difference === 0) {
        score += 5;
      } else if (difference === 1) {
        score += 3;
      }


      // Shared mechanics

      const referenceConcepts =
        inferCardConcepts(
          reference
        );


      const shared =
        concepts.filter(
          concept =>
            referenceConcepts.includes(
              concept
            )
        );


      score +=
        Math.min(
          10,
          shared.length * 2
        );


      // Shared keywords

      const aText =
        normalize(
          card.oracle_text || ""
        );

      const bText =
        normalize(
          reference.oracle_text || ""
        );


      const keywords = [
        "flying",
        "haste",
        "trample",
        "deathtouch",
        "lifelink",
        "menace",
        "vigilance",
        "flash",
        "hexproof",
        "indestructible",
        "ward",
        "draw",
        "sacrifice",
        "graveyard",
        "damage",
        "token",
        "discard",
        "counter",
        "exile"
      ];


      for (
        const keyword of keywords
      ) {

        if (
          aText.includes(keyword) &&
          bText.includes(keyword)
        ) {

          score += 1;
        }
      }


      score =
        Math.min(
          25,
          score
        );


      if (
        score > best.score
      ) {

        best = {
          score,
          name: reference.name
        };
      }
    }


    return best;
  }


  // ============================================================
  // RESULTS UI
  // ============================================================
  //
  // Only the TOP 500 ranked cards are kept for display.
  // Pagination then displays 30 cards per page.
  //
  // This also defines renderCard(), which was missing and caused:
  //
  //     ReferenceError: renderCard is not defined
  //
  // ============================================================

  const MAX_DISPLAY_RESULTS = 500;
  const CARDS_PER_PAGE = 30;

  let currentPage = 1;


  // ============================================================
  // RENDER RESULTS
  // ============================================================

  function renderResults(page = 1) {

    // ----------------------------------------------------------
    // IMPORTANT:
    // Only keep the best 500 cards for the UI.
    //
    // currentCards is already sorted by score in runSearch().
    // ----------------------------------------------------------

    if (currentCards.length > MAX_DISPLAY_RESULTS) {

      currentCards =
        currentCards.slice(
          0,
          MAX_DISPLAY_RESULTS
        );
    }


    // ----------------------------------------------------------
    // Calculate pagination.
    // ----------------------------------------------------------

    const totalPages =
      Math.max(
        1,
        Math.ceil(
          currentCards.length /
          CARDS_PER_PAGE
        )
      );


    currentPage =
      Math.min(
        Math.max(
          1,
          page
        ),
        totalPages
      );


    // ----------------------------------------------------------
    // Remove old pagination before rendering.
    // ----------------------------------------------------------

    const oldPagination =
      document.getElementById(
        "mtg-pagination"
      );


    if (oldPagination) {

      oldPagination.remove();
    }


    // ----------------------------------------------------------
    // Cards for current page.
    // ----------------------------------------------------------

    const start =
      (currentPage - 1) *
      CARDS_PER_PAGE;


    const end =
      Math.min(
        start + CARDS_PER_PAGE,
        currentCards.length
      );


    const visible =
      currentCards.slice(
        start,
        end
      );


    // ----------------------------------------------------------
    // Empty state.
    // ----------------------------------------------------------

    if (!visible.length) {

      results.innerHTML = `
        <div class="empty">
          <p>No cards to display.</p>
        </div>
      `;

      return;
    }


    // ----------------------------------------------------------
    // Render cards.
    // ----------------------------------------------------------

    results.innerHTML =
      visible
        .map(
          (card, index) =>
            renderCard(
              card,
              start + index
            )
        )
        .join("");


    // ----------------------------------------------------------
    // Card click handlers.
    // ----------------------------------------------------------

    results
      .querySelectorAll(
        "[data-card-index]"
      )
      .forEach(
        element => {

          element.addEventListener(
            "click",
            event => {

              // Don't intercept clicks on links/buttons
              // inside a card.

              if (
                event.target.closest(
                  "a, button"
                )
              ) {
                return;
              }


              openCard(
                Number(
                  element.dataset.cardIndex
                )
              );
            }
          );
        }
      );


    // ----------------------------------------------------------
    // Pagination.
    // ----------------------------------------------------------

    renderPagination(
      currentPage,
      totalPages
    );
  }


  // ============================================================
  // CARD RENDERER
  // ============================================================

  function renderCard(
    card,
    index
  ) {

    const match =
      card._match || {
        total: 0,
        reasons: []
      };


    const image =
      card.image_uris?.normal ||
      card.image_uris?.large ||
      card.card_faces?.[0]
        ?.image_uris?.normal ||
      card.card_faces?.[0]
        ?.image_uris?.large ||
      "";


    const name =
      escapeHtml(
        card.name || "Unknown card"
      );


    const mana =
      escapeHtml(
        card.mana_cost || ""
      );


    const typeLine =
      escapeHtml(
        card.type_line || ""
      );


    const oracle =
      escapeHtml(
        card.oracle_text || ""
      );


    const setName =
      escapeHtml(
        card.set_name || ""
      );


    const rarity =
      escapeHtml(
        card.rarity || ""
      );


    const score =
      Math.max(
        0,
        Math.min(
          100,
          Number(match.total) || 0
        )
      );


    const reasons =
      Array.isArray(
        match.reasons
      )
        ? match.reasons
        : [];


    // ----------------------------------------------------------
    // Image
    // ----------------------------------------------------------

    const imageHtml =
      image
        ? `
          <img
            src="${escapeHtml(image)}"
            alt="${name}"
            loading="lazy"
            draggable="false"
            style="
              width:100%;
              display:block;
              border-radius:10px;
              background:#18161d;
            "
          >
        `
        : `
          <div
            style="
              aspect-ratio:488/680;
              display:flex;
              align-items:center;
              justify-content:center;
              padding:20px;
              text-align:center;
              background:#18161d;
              border-radius:10px;
              color:#77737e;
              font-size:12px;
            "
          >
            No image
          </div>
        `;


    // ----------------------------------------------------------
    // Match reasons
    // ----------------------------------------------------------

    const reasonsHtml =
      reasons.length
        ? `
          <div
            style="
              margin-top:10px;
              color:#aaa7b0;
              font-size:10px;
              line-height:1.5;
            "
          >
            ${reasons
              .slice(0, 3)
              .map(
                reason =>
                  `<div>✓ ${escapeHtml(reason)}</div>`
              )
              .join("")}
          </div>
        `
        : "";


    // ----------------------------------------------------------
    // Oracle text
    // ----------------------------------------------------------

    const oracleHtml =
      oracle
        ? `
          <div
            style="
              margin-top:10px;
              color:#aaa7b0;
              font-size:11px;
              line-height:1.45;
              display:-webkit-box;
              -webkit-line-clamp:4;
              -webkit-box-orient:vertical;
              overflow:hidden;
            "
          >
            ${oracle}
          </div>
        `
        : "";


    // ----------------------------------------------------------
    // Card HTML
    // ----------------------------------------------------------

    return `
      <article
        class="mtg-card-result"
        data-card-index="${index}"
        tabindex="0"
        role="button"
        aria-label="View ${name}"
        style="
          position:relative;
          display:flex;
          flex-direction:column;
          min-width:0;
          background:#111014;
          border:1px solid #302e35;
          border-radius:12px;
          overflow:hidden;
          cursor:pointer;
          transition:
            transform .15s ease,
            border-color .15s ease,
            box-shadow .15s ease;
        "
        onmouseenter="
          this.style.transform='translateY(-3px)';
          this.style.borderColor='#d4af67';
          this.style.boxShadow='0 8px 25px rgba(0,0,0,.35)';
        "
        onmouseleave="
          this.style.transform='translateY(0)';
          this.style.borderColor='#302e35';
          this.style.boxShadow='none';
        "
        onkeydown="
          if(event.key==='Enter' || event.key===' '){
            event.preventDefault();
            this.click();
          }
        "
      >

        <!-- CARD IMAGE -->

        <div
          style="
            position:relative;
            line-height:0;
          "
        >

          ${imageHtml}


          <!-- MATCH BADGE -->

          <div
            style="
              position:absolute;
              top:8px;
              right:8px;
              min-width:42px;
              padding:5px 7px;
              border-radius:7px;
              background:rgba(9,9,12,.92);
              border:1px solid #d4af67;
              color:#d4af67;
              font-size:11px;
              font-weight:700;
              line-height:1;
              text-align:center;
              box-shadow:0 2px 8px rgba(0,0,0,.4);
            "
          >
            ${score}%
          </div>

        </div>


        <!-- CARD INFORMATION -->

        <div
          style="
            display:flex;
            flex-direction:column;
            flex:1;
            padding:12px;
          "
        >

          <!-- NAME -->

          <div
            style="
              display:flex;
              align-items:flex-start;
              justify-content:space-between;
              gap:8px;
            "
          >

            <h3
              style="
                margin:0;
                color:#eeeaf0;
                font-size:14px;
                line-height:1.3;
                font-weight:700;
              "
            >
              ${name}
            </h3>

          </div>


          <!-- MANA -->

          ${
            mana
              ? `
                <div
                  style="
                    margin-top:5px;
                    color:#d4af67;
                    font-size:11px;
                    font-weight:600;
                  "
                >
                  ${mana}
                </div>
              `
              : ""
          }


          <!-- TYPE -->

          ${
            typeLine
              ? `
                <div
                  style="
                    margin-top:6px;
                    color:#77737e;
                    font-size:10px;
                    line-height:1.35;
                  "
                >
                  ${typeLine}
                </div>
              `
              : ""
          }


          ${oracleHtml}


          <!-- REASONS -->

          ${reasonsHtml}


          <!-- FOOTER -->

          <div
            style="
              display:flex;
              align-items:center;
              justify-content:space-between;
              gap:8px;
              margin-top:auto;
              padding-top:12px;
            "
          >

            ${
              setName
                ? `
                  <span
                    style="
                      min-width:0;
                      overflow:hidden;
                      text-overflow:ellipsis;
                      white-space:nowrap;
                      color:#77737e;
                      font-size:9px;
                    "
                    title="${setName}"
                  >
                    ${setName}
                  </span>
                `
                : `
                  <span></span>
                `
            }


            ${
              rarity
                ? `
                  <span
                    style="
                      color:#77737e;
                      font-size:9px;
                      text-transform:capitalize;
                    "
                  >
                    ${rarity}
                  </span>
                `
                : ""
            }

          </div>

        </div>

      </article>
    `;
  }


  // ============================================================
  // PAGINATION
  // ============================================================

  function renderPagination(
    page,
    totalPages
  ) {

    const oldPagination =
      document.getElementById(
        "mtg-pagination"
      );


    if (oldPagination) {

      oldPagination.remove();
    }


    if (totalPages <= 1) {

      return;
    }


    const pagination =
      document.createElement(
        "div"
      );


    pagination.id =
      "mtg-pagination";


    pagination.style.cssText = `
      display:flex;
      flex-wrap:wrap;
      justify-content:center;
      align-items:center;
      gap:6px;
      margin:30px 0 50px;
      padding:15px;
    `;


    // ----------------------------------------------------------
    // Previous
    // ----------------------------------------------------------

    const previous =
      createPageButton(
        "‹",
        page > 1,
        () => {

          renderResults(
            page - 1
          );

          scrollResultsToTop();
        }
      );


    previous.title =
      "Previous page";


    pagination.appendChild(
      previous
    );


    // ----------------------------------------------------------
    // Page numbers
    // ----------------------------------------------------------

    const pages =
      getPageNumbers(
        page,
        totalPages
      );


    pages.forEach(
      pageNumber => {

        if (
          pageNumber === "..."
        ) {

          const dots =
            document.createElement(
              "span"
            );


          dots.textContent =
            "…";


          dots.style.cssText = `
            color:#77737e;
            padding:8px 5px;
          `;


          pagination.appendChild(
            dots
          );


          return;
        }


        const button =
          createPageButton(
            String(pageNumber),
            true,
            () => {

              renderResults(
                pageNumber
              );

              scrollResultsToTop();
            }
          );


        if (
          pageNumber === page
        ) {

          button.style.background =
            "#d4af67";

          button.style.color =
            "#111014";

          button.style.borderColor =
            "#d4af67";

          button.style.fontWeight =
            "700";
        }


        pagination.appendChild(
          button
        );
      }
    );


    // ----------------------------------------------------------
    // Next
    // ----------------------------------------------------------

    const next =
      createPageButton(
        "›",
        page < totalPages,
        () => {

          renderResults(
            page + 1
          );

          scrollResultsToTop();
        }
      );


    next.title =
      "Next page";


    pagination.appendChild(
      next
    );


    // ----------------------------------------------------------
    // Result information
    // ----------------------------------------------------------

    const start =
      ((page - 1) *
        CARDS_PER_PAGE) + 1;


    const end =
      Math.min(
        page * CARDS_PER_PAGE,
        currentCards.length
      );


    const info =
      document.createElement(
        "div"
      );


    info.style.cssText = `
      width:100%;
      text-align:center;
      margin-top:10px;
      color:#77737e;
      font-size:11px;
    `;


    info.textContent =
      `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${currentCards.length.toLocaleString()} top results`;


    pagination.appendChild(
      info
    );


    if (
      results.parentNode
    ) {

      results.parentNode.appendChild(
        pagination
      );
    }
  }


  // ============================================================
  // PAGE NUMBER GENERATOR
  // ============================================================

  function getPageNumbers(
    current,
    total
  ) {

    if (total <= 9) {

      return Array.from(
        {
          length: total
        },
        (_, i) => i + 1
      );
    }


    const pages = [];


    pages.push(1);


    // Near beginning.

    if (
      current <= 4
    ) {

      pages.push(2);
      pages.push(3);
      pages.push(4);
      pages.push(5);
      pages.push("...");
      pages.push(total);

      return pages;
    }


    // Near end.

    if (
      current >=
      total - 3
    ) {

      pages.push("...");
      pages.push(total - 4);
      pages.push(total - 3);
      pages.push(total - 2);
      pages.push(total - 1);
      pages.push(total);

      return pages;
    }


    // Middle.

    pages.push("...");
    pages.push(current - 1);
    pages.push(current);
    pages.push(current + 1);
    pages.push("...");
    pages.push(total);


    return pages;
  }


  // ============================================================
  // PAGINATION BUTTON
  // ============================================================

  function createPageButton(
    label,
    enabled,
    onClick
  ) {

    const button =
      document.createElement(
        "button"
      );


    button.type =
      "button";


    button.textContent =
      label;


    button.style.cssText = `
      min-width:36px;
      height:36px;
      padding:0 10px;
      border:1px solid #302e35;
      border-radius:7px;
      background:#111014;
      color:#aaa7b0;
      cursor:pointer;
      font-size:12px;
      transition:
        background .15s ease,
        color .15s ease,
        border-color .15s ease;
    `;


    if (!enabled) {

      button.disabled =
        true;

      button.style.opacity =
        "0.35";

      button.style.cursor =
        "default";

    } else {

      button.addEventListener(
        "mouseenter",
        () => {

          if (
            !button.disabled
          ) {

            button.style.borderColor =
              "#d4af67";

            button.style.color =
              "#d4af67";
          }
        }
      );


      button.addEventListener(
        "mouseleave",
        () => {

          if (
            !button.disabled
          ) {

            button.style.borderColor =
              "#302e35";

            button.style.color =
              "#aaa7b0";
          }
        }
      );


      button.addEventListener(
        "click",
        onClick
      );
    }


    return button;
  }


  // ============================================================
  // SCROLL BACK TO RESULTS
  // ============================================================

  function scrollResultsToTop() {

    if (!results) {

      return;
    }


    const top =
      results.getBoundingClientRect()
        .top +
      window.scrollY -
      100;


    window.scrollTo({
      top,
      behavior: "smooth"
    });
  }


  // ============================================================
  // CARD MODAL
  // ============================================================

  function openCard(index) {

    const card =
      currentCards[index];

    if (!card || !modal) return;

    currentCardIndex = index;


    const image =
      card.image_uris?.large ||
      card.card_faces?.[0]
        ?.image_uris?.large;


    const modalImage =
      document.getElementById(
        "modal-image"
      );

    const modalDetails =
      document.getElementById(
        "modal-details"
      );


    if (modalImage && image) {

      modalImage.src =
        image;

      modalImage.alt =
        card.name;
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
            padding:12px;
            margin-bottom:18px;
            border:1px solid #302e35;
            background:#111014;
            border-radius:10px;
          "
        >

          <div
            style="
              display:flex;
              justify-content:space-between;
              margin-bottom:6px;
            "
          >

            <span
              style="color:#aaa7b0"
            >
              Match
            </span>

            <strong
              style="color:#d4af67"
            >
              ${match.total}%
            </strong>

          </div>


          <div
            style="
              height:5px;
              background:#28252d;
              border-radius:99px;
              overflow:hidden;
            "
          >

            <div
              style="
                width:${match.total}%;
                height:100%;
                background:#d4af67;
              "
            ></div>

          </div>


          ${
            match.reasons.length
              ? `
                <div
                  style="
                    margin-top:10px;
                    color:#aaa7b0;
                    font-size:12px;
                    line-height:1.6;
                  "
                >
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


        ${detail(
          "Mana",
          card.mana_cost
        )}

        ${detail(
          "Type",
          card.type_line
        )}

        ${detail(
          "Rules",
          card.oracle_text
        )}

        ${
          card.flavor_text
            ? detail(
                "Flavor",
                card.flavor_text,
                true
              )
            : ""
        }

        ${detail(
          "Set",
          card.set_name
        )}

        ${
          card.scryfall_uri
            ? `
              <br>

              <a
                href="${escapeHtml(
                  card.scryfall_uri
                )}"
                target="_blank"
                rel="noopener noreferrer"
                style="color:#d4af67"
              >
                View on Scryfall →
              </a>
            `
            : ""
        }
      `;
    }


    modal.classList.remove(
      "hidden"
    );

    updateCardNavigation();
  }

  // ============================================================
  // MOBILE CARD NAVIGATION BUTTONS
  // ============================================================

  function updateCardNavigation() {

    const previousButton =
      document.getElementById(
        "previous-card"
      );

    const nextButton =
      document.getElementById(
        "next-card"
      );

    if (!previousButton || !nextButton) {
      return;
    }

    // Disable Previous on the first card.
    previousButton.disabled =
      currentCardIndex <= 0;

    // Disable Next on the last card.
    nextButton.disabled =
      currentCardIndex >=
      currentCards.length - 1;

    previousButton.style.opacity =
      previousButton.disabled
        ? "0.35"
        : "1";

    nextButton.style.opacity =
      nextButton.disabled
        ? "0.35"
        : "1";
  }


  // Previous button.
  document.addEventListener("click", event => {

    if (
      event.target.closest(
        "#previous-card"
      )
    ) {

      if (
        currentCardIndex > 0
      ) {

        openCard(
          currentCardIndex - 1
        );
      }
    }
  });


  // Next button.
  document.addEventListener("click", event => {

    if (
      event.target.closest(
        "#next-card"
      )
    ) {

      if (
        currentCardIndex <
        currentCards.length - 1
      ) {

        openCard(
          currentCardIndex + 1
        );
      }
    }
  });



  function detail(
    label,
    value,
    italic = false
  ) {

    if (!value) {
      value = "—";
    }


    return `
      <div
        style="
          margin-top:13px;
        "
      >

        <div
          style="
            color:#77737e;
            font-size:10px;
            text-transform:uppercase;
            letter-spacing:.08em;
            margin-bottom:4px;
          "
        >
          ${escapeHtml(label)}
        </div>

        <div
          style="
            color:#ddd9e0;
            line-height:1.5;
          "
        >
          ${
            italic
              ? `<em>${escapeHtml(value)}</em>`
              : escapeHtml(value)
          }
        </div>

      </div>
    `;
  }


  // ============================================================
  // INTERPRETATION UI
  // ============================================================

  function renderInterpretation(
    intent
  ) {

    if (!interpretation) {
      return;
    }


    const chips = [];


    intent.colors.forEach(
      color =>
        chips.push(
          `Color ${color}`
        )
    );


    intent.cardTypes.forEach(
      type =>
        chips.push(
          type
        )
    );


    intent.subtypes.forEach(
      subtype =>
        chips.push(
          subtype
        )
    );


    intent.concepts.forEach(
      concept =>
        chips.push(
          prettyConcept(
            concept
          )
        )
    );


    intent.keywords.forEach(
      keyword =>
        chips.push(
          keyword
        )
    );


    intent.references.forEach(
      reference =>
        chips.push(
          `similar to ${reference}`
        )
    );


    interpretation.innerHTML = `
      <details>

        <summary>
          Interpreted as
          ${
            chips.length
              ? ` · ${chips
                  .slice(0, 5)
                  .join(" · ")}`
              : ""
          }
        </summary>

        <div
          style="
            margin-top:10px;
            padding:12px;
            background:#09090c;
            border:1px solid #302e35;
            border-radius:10px;
          "
        >

          <pre
            style="
              margin:0;
              color:#aaa7b0;
              font-size:11px;
              line-height:1.5;
              white-space:pre-wrap;
            "
          >${escapeHtml(
            JSON.stringify(
              intent,
              null,
              2
            )
          )}</pre>

        </div>

      </details>
    `;
  }


  function prettyConcept(
    concept
  ) {

    return concept
      .replace(
        /^keyword:/,
        ""
      )
      .replaceAll(
        "_",
        " "
      );
  }


  // ============================================================
  // HELPERS
  // ============================================================

  function normalize(value) {

    return String(
      value || ""
    )
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }


  function hasWord(
    text,
    word
  ) {

    return new RegExp(
      `(^|\\s)${escapeRegex(
        word
      )}(?=\\s|$)`,
      "i"
    ).test(text);
  }


  function addUnique(
    array,
    value
  ) {

    if (
      !array.includes(value)
    ) {

      array.push(value);
    }
  }


  function escapeRegex(
    value
  ) {

    return String(value)
      .replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
  }


  function escapeHtml(
    value
  ) {

    return String(
      value ?? ""
    )
      .replaceAll(
        "&",
        "&amp;"
      )
      .replaceAll(
        "<",
        "&lt;"
      )
      .replaceAll(
        ">",
        "&gt;"
      )
      .replaceAll(
        '"',
        "&quot;"
      )
      .replaceAll(
        "'",
        "&#039;"
      );
  }


  function quoteScryfallName(
    name
  ) {

    return `"${String(name)
      .replaceAll(
        '"',
        ""
      )}"`;
  }


  function setStatus(
    message
  ) {

    if (status) {
      status.textContent =
        message;
    }
  }

});
