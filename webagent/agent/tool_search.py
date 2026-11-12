"""Small BM25 retriever used to keep large tool catalogs out of every prompt."""

from __future__ import annotations

import math
import re
from collections import Counter

from webagent.agent.mcp_client import ToolSpec


ASCII_RE = re.compile(r"[a-z0-9_]+")
CJK_RE = re.compile(r"[\u3400-\u9fff]")


def tokenize(value: str) -> list[str]:
    text = str(value or "").lower()
    tokens = ASCII_RE.findall(text)
    chars = CJK_RE.findall(text)
    tokens.extend(chars)
    tokens.extend(
        "".join(chars[index : index + 2])
        for index in range(max(0, len(chars) - 1))
    )
    return tokens


def _document(spec: ToolSpec) -> str:
    properties = (spec.input_schema or {}).get("properties") or {}
    return " ".join(
        [
            spec.name,
            spec.description,
            spec.category,
            spec.permission,
            " ".join(map(str, properties.keys())),
        ]
    )


def rank_tools(
    specs: list[ToolSpec], query: str, limit: int = 16
) -> tuple[list[ToolSpec], bool]:
    if len(specs) <= limit:
        return specs, False
    documents = [tokenize(_document(spec)) for spec in specs]
    query_tokens = tokenize(query)
    if not query_tokens:
        return specs[:limit], True
    doc_count = len(documents)
    avg_len = sum(len(doc) for doc in documents) / max(1, doc_count)
    doc_freq: Counter[str] = Counter()
    for doc in documents:
        doc_freq.update(set(doc))
    scores: list[float] = []
    k1, b = 1.5, 0.75
    for doc in documents:
        counts = Counter(doc)
        score = 0.0
        for token in set(query_tokens):
            frequency = counts[token]
            if not frequency:
                continue
            df = doc_freq[token]
            idf = math.log(1 + (doc_count - df + 0.5) / (df + 0.5))
            denominator = frequency + k1 * (
                1 - b + b * len(doc) / max(1.0, avg_len)
            )
            score += idf * frequency * (k1 + 1) / denominator
        scores.append(score)
    ranked = sorted(
        zip(scores, specs), key=lambda item: (-item[0], item[1].name)
    )
    selected = [spec for score, spec in ranked[:limit]]
    return selected, True
