Yes. At this point, **stop adding to `app.js`**. We should turn this into a tiny modular search engine.

 The goal should be:

 > **HTML/CSS = presentation, JS modules = pipeline, Scryfall = database, semantic layer = translation + ranking.**

 No framework, no build step, no backend, no API key.

 ## Proposed architecture

```
mtg-card-lab/
│
├── index.html
├── style.css
│
└── js/
    ├── app.js                 ← ~50 lines, orchestration only
    │
    ├── config.js              ← API URL + constants
    │
    ├── search/
    │   ├── scryfall.js        ← Scryfall API communication
    │   ├── candidates.js      ← broad candidate retrieval
    │   └── search.js          ← overall search pipeline
    │
    ├── semantic/
    │   ├── interpreter.js     ← query → structured intent
    │   ├── vocabulary.js      ← synonyms / MTG concepts
    │   ├── patterns.js        ← Oracle-text patterns
    │   └── normalizer.js      ← clean/merge interpreted intent
    │
    ├── ranking/
    │   ├── scorer.js          ← card ↔ intent score
    │   ├── features.js        ← extract features from cards
    │   └── explanation.js     ← "why this matched"
    │
    └── ui/
        ├── renderer.js        ← cards/results
        ├── queryView.js       ← interpreted-query display
        └── loading.js         ← loading/errors/empty states
```

 That's **12 small files**, but each has one job.

 The important part is that `app.js` becomes almost boring.

---

 # 1\. `app.js`

 It should basically be:

```
import { searchCards } from "./search/search.js";
import { renderResults, renderError } from "./ui/renderer.js";
import { showLoading } from "./ui/loading.js";

const form = document.querySelector("#search-form");
const input = document.querySelector("#search-input");

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const query = input.value.trim();
    if (!query) return;

    showLoading(true);

    try {
        const result = await searchCards(query);
        renderResults(result);
    } catch (error) {
        console.error(error);
        renderError(error);
    } finally {
        showLoading(false);
    }
});
```

 That's it.

 If `app.js` becomes 300 lines again, we've broken the architecture.

---

 # 2\. Semantic interpreter

 `semantic/interpreter.js`

 This owns **understanding English**.

 It should output a consistent object:

```
{
    originalQuery: "...",

    identity: {
        colors: [],
        colorMode: "any"
    },

    structure: {
        types: [],
        subtypes: [],
        supertypes: [],
        manaValue: {
            min: null,
            max: null,
            exact: null
        },
        power: {},
        toughness: {}
    },

    mechanics: [],

    relationships: [],

    zones: [],

    strategy: [],

    references: [],

    exclusions: [],

    preferences: []
}
```

 The interpreter **doesn't talk to Scryfall**.

 It doesn't rank cards.

 It doesn't touch HTML.

 That's critical.

---

 # 3\. Vocabulary

 `semantic/vocabulary.js`

 This becomes our semantic knowledge base.

 For example:

```
export const COLORS = {
    white: "w",
    blue: "u",
    black: "b",
    red: "r",
    green: "g",
    colorless: "c"
};

export const SYNONYMS = {
    ramp: [
        "ramp",
        "mana acceleration",
        "accelerate mana",
        "ramp my mana",
        "get extra lands"
    ],

    draw: [
        "draw",
        "card draw",
        "draw cards",
        "card advantage"
    ],

    graveyardReturn: [
        "come back from the graveyard",
        "return from the graveyard",
        "return to the battlefield",
        "recursion",
        "recur",
        "reanimate"
    ],

    burn: [
        "burn",
        "direct damage",
        "deal damage"
    ],

    sacrifice: [
        "sacrifice",
        "sac",
        "sacrifice my creatures"
    ]
};
```

 This is where we keep expanding semantic coverage.

 Not `app.js`.

---

 # 4\. Oracle patterns

 This is probably the **most important new file**.

 `semantic/patterns.js`

 Instead of teaching the interpreter every exact MTG wording, we define what a concept looks like in card text.

 For example:

```
export const PATTERNS = {

    draw: [
        /draw (a|one|two|three|four|five|\d+) cards?/i
    ],

    damage: [
        /deals? \w* ?damage/i
    ],

    exile: [
        /\bexile\b/i
    ],

    graveyardReturn: [
        /return .* from (your|an opponent's|their) graveyard/i,
        /return .* card .* graveyard .* battlefield/i
    ],

    entersBattlefield: [
        /enters the battlefield/i,
        /enter(s)? the battlefield/i
    ],

    dies: [
        /\bdies\b/i,
        /is put into a graveyard/i
    ],

    sacrifice: [
        /\bsacrifice\b/i
    ],

    lifelink: [
        /\blifelink\b/i
    ]
};
```

 Now:

 > "creatures that come back from the graveyard"

 and:

 > "creatures that recur themselves"

 can eventually map to the same semantic feature.

---

 # 5\. Candidate retrieval

 `search/candidates.js`

 This should be intentionally **broad**.

 Given:

```
{
    colors: ["u"],
    types: ["creature"],
    manaValue: { max: 3 }
}
```

 it generates:

```
color:u type:creature mv<=3
```

 But mechanics aren't necessarily pushed into Scryfall.

 That's deliberate.

 For:

 > blue creatures that draw cards when they enter the battlefield

 we don't want:

```
color:u type:creature mv<=3 oracle:"draw a card" oracle:"enters the battlefield"
```

 because one overly-specific query can kill recall.

 Instead:

```
color:u type:creature mv<=3
```

 → retrieve candidates

 → semantic scoring.

---

 # 6\. Scryfall module

 `search/scryfall.js`

 Only this file knows:

```
api.scryfall.com
```

 It exposes things like:

```
export async function search(query) {
    // fetch Scryfall
}

export async function getCard(name) {
    // exact/reference lookup
}
```

 Everything else treats Scryfall as an abstraction.

 That means if we eventually replace Scryfall with another database, we're not rewriting the application.

---

 # 7\. Feature extraction

 `ranking/features.js`

 This converts a card into a searchable semantic representation.

 For example:

```
export function extractFeatures(card) {
    const text = `${card.name} ${card.oracle_text || ""}`;

    return {
        colors: card.colors || [],
        type: card.type_line || "",

        manaValue: card.cmc,

        draw: matches("draw", text),
        damage: matches("damage", text),
        exile: matches("exile", text),
        sacrifice: matches("sacrifice", text),

        entersBattlefield:
            matches("entersBattlefield", text),

        dies:
            matches("dies", text),

        graveyardReturn:
            matches("graveyardReturn", text),

        lifelink:
            matches("lifelink", text)
    };
}
```

 Now the ranking engine isn't trying to understand raw Oracle text every time.

---

 # 8\. Scoring

 `ranking/scorer.js`

 This is where your **best-match bars** originate.

 Something like:

```
export function scoreCard(card, intent) {
    const features = extractFeatures(card);

    const scores = {};

    scores.identity = scoreIdentity(features, intent);
    scores.structure = scoreStructure(features, intent);
    scores.mechanics = scoreMechanics(features, intent);
    scores.relationships = scoreRelationships(features, intent);
    scores.preferences = scorePreferences(features, intent);

    const total =
        scores.identity * 0.20 +
        scores.structure * 0.25 +
        scores.mechanics * 0.30 +
        scores.relationships * 0.20 +
        scores.preferences * 0.05;

    return {
        total,
        scores,
        features
    };
}
```

 Now we can show:

```
MATCH

Identity       ██████████ 100%
Structure      ██████████ 100%
Mechanics      █████████░  91%
Relationship   ██████████ 100%
Preferences    ████████░░  80%

Overall        94%
```

 That's much more useful than simply saying "Scryfall returned this."

---

 # 9\. Explanation layer

 `ranking/explanation.js`

 This converts the score into human-readable reasons:

```
[
    "Matches blue",
    "Is a creature",
    "Costs 3 mana",
    "Draws cards",
    "Triggers when it enters the battlefield"
]
```

 So the UI can say:

 > **Why this matched**

 rather than dumping the JSON interpreter output on the user.

---

 # 10\. The actual search pipeline

 `search/search.js`

 This becomes the conductor:

```
import { interpret } from "../semantic/interpreter.js";
import { buildCandidateQuery } from "./candidates.js";
import { search as scryfallSearch } from "./scryfall.js";
import { scoreCard } from "../ranking/scorer.js";
import { explainMatch } from "../ranking/explanation.js";

export async function searchCards(query) {

    const intent = interpret(query);

    const candidateQuery = buildCandidateQuery(intent);

    const cards = await scryfallSearch(candidateQuery);

    const ranked = cards
        .map(card => ({
            card,
            match: scoreCard(card, intent)
        }))
        .sort((a, b) =>
            b.match.total - a.match.total
        );

    return {
        query,
        intent,
        candidateQuery,
        results: ranked
    };
}
```

 This is the key.

 Every search follows:

```
query
 ↓
interpret
 ↓
normalize
 ↓
candidate query
 ↓
Scryfall
 ↓
feature extraction
 ↓
semantic scoring
 ↓
explanation
 ↓
UI
```

---

 # The really useful part: graceful degradation

 We should explicitly design for **zero results**.

 If Scryfall gives:

```
0 cards
```

 we don't immediately say:

 > Search failed.

 Instead:

```
Attempt 1
Precise candidate query

       ↓ 0

Attempt 2
Relax optional constraints

       ↓

Rank locally
```

 For example:

 > cheap blue creatures that draw cards when they enter the battlefield

 could progressively go:

```
color:u type:creature mv<=3
```

 If that fails:

```
color:u type:creature
```

 If that somehow fails:

```
color:u
```

 Then semantic ranking determines the best matches.

 This gives us **high recall first, precision second**.

 That's the right architecture for what we're building.

---

 # And we can make semantic interpretation deterministic

 Since you wanted the procedural/reproducible angle earlier, I'd keep the semantic layer deterministic too.

 Same:

 > `black creatures that come back from the graveyard`

 should produce the same:

```
{
  "colors": ["b"],
  "types": ["creature"],
  "mechanics": ["graveyardReturn"]
}
```

 every time.

 No LLM required.

 Later, if we want an optional LLM/JEV-like interpreter, we can add it as:

```
semantic/
    interpreter.js
    deterministic.js
    llm.js
```

 with:

```
interpret()
```

 choosing whichever backend is available.

 The rest of the application doesn't care.

---

 # What I'd build now

 Don't make all 12 files huge either.

 I'd start with **8 files**:

```
js/
├── app.js
├── config.js
│
├── semantic/
│   ├── interpreter.js
│   ├── vocabulary.js
│   └── patterns.js
│
├── search/
│   ├── scryfall.js
│   └── search.js
│
├── ranking/
│   └── scorer.js
│
└── ui/
    └── renderer.js
```

 Then split `scorer.js` and `renderer.js` only when they actually get large.

 ### The rule

 **No file gets to become a dumping ground.**

 - `interpreter.js` understands language.
- `vocabulary.js` knows words.
- `patterns.js` knows MTG text.
- `scryfall.js` talks to Scryfall.
- `search.js` coordinates retrieval.
- `scorer.js` ranks.
- `renderer.js` renders.
- `app.js` wires everything together.

 That gives us a foundation where we can keep improving **semantic coverage without continually destabilizing the rest of the app**.

 And importantly, this is still a **GitHub Pages-only project**. No backend, no API keys, no build system, and no need for you to learn a framework. We can replace the current JS with these small files and iterate one module at a time.
