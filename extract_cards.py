import json
from pathlib import Path

deck_dir = Path("src/content/ai-coding")
deck_files = [
    "patterns_backtracking.json",
    "patterns_data-structure-design.json", 
    "patterns_dynamic-programming.json",
    "patterns_graph-search.json",
    "patterns_greedy-algorithms.json",
    "patterns_string-matching.json",
    "patterns_topological-sort.json"
]

for deck_file in deck_files:
    deck_path = deck_dir / deck_file
    with open(deck_path) as f:
        cards = json.load(f)
    
    eligible = []
    for card in cards:
        if card.get("format") not in ["mcq", "multi", "code"]:
            continue
        if "optionExplanations" in card:
            continue
        eligible.append(card)
    
    print(f"{deck_file}: {len(eligible)} eligible cards")
    for card in eligible[:1]:
        print(f"  - {card['id']}: format={card['format']}, options={len(card['options'])}")
