"""Editable connection templates; presets do not create configured providers."""

from __future__ import annotations

from typing import Any


def list_provider_presets() -> list[dict[str, Any]]:
    definitions = [
        ("openai", "OpenAI", "https://api.openai.com/v1", ["chat", "voice", "image"], "Chat Completions、STT、TTS 与 Images，按账号实际权限使用。", [
            ("gpt-4.1-mini", "GPT-4.1 mini", "chat"),
            ("gpt-4o-mini-transcribe", "GPT-4o mini · STT", "asr"),
            ("gpt-4o-mini-tts", "GPT-4o mini · TTS", "tts"),
            ("gpt-image-1", "GPT Image", "image_generation"),
        ]),
        ("deepseek", "DeepSeek", "https://api.deepseek.com/v1", ["chat"], "OpenAI 兼容对话接口，推理能力以实际模型声明为准。", [
            ("deepseek-chat", "DeepSeek Chat", "chat"),
            ("deepseek-reasoner", "DeepSeek Reasoner", "chat"),
        ]),
        ("dashscope", "通义千问 / 百炼", "https://dashscope.aliyuncs.com/compatible-mode/v1", ["chat", "voice"], "对话使用兼容接口；Qwen STT/TTS 可在模型中选择 DashScope 原生协议。", [
            ("qwen-plus", "Qwen Plus", "chat"),
            ("qwen-flash", "Qwen Flash", "chat"),
            ("qwen3-asr-flash", "Qwen3 ASR · STT", "asr"),
            ("qwen3-tts-flash", "Qwen3 TTS", "tts"),
        ]),
        ("zhipu", "智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", ["chat"], "智谱标准 API；Coding Plan 需改用对应专用地址。", [
            ("glm-4.5-flash", "GLM-4.5 Flash", "chat"),
        ]),
        ("moonshot", "Moonshot / Kimi", "https://api.moonshot.cn/v1", ["chat"], "Moonshot 标准 API；模型列表以账号返回为准。", [
            ("moonshot-v1-32k", "Moonshot 32K", "chat"),
        ]),
        ("minimax", "MiniMax", "https://api.minimax.io/v1", ["chat"], "仅使用 OpenAI 兼容对话协议；原生语音接口不复用此模板。", []),
        ("doubao", "火山方舟 / 豆包", "https://ark.cn-beijing.volces.com/api/v3", ["chat", "image"], "填写模型 ID 或已开通的推理接入点；图片生成以兼容 Images 的模型为准。", []),
        ("siliconflow", "硅基流动", "https://api.siliconflow.cn/v1", ["chat", "voice", "image"], "使用兼容接口；音色、模型和参数需按服务商文档配置。", []),
        ("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", ["chat", "decision"], "对话走 /api/v1；Jev / Microsoft 决策在模型中使用 /api/alpha/decisions。", [
            ("typesafe/jev-1.13", "Jev · 决策", "decision"),
            ("microsoft/microsoft-decision-1", "Microsoft Decision", "decision"),
        ]),
        ("ollama", "Ollama", "http://127.0.0.1:11434/v1", ["chat"], "连接已启动的本地 OpenAI 兼容服务，不负责下载或启动模型。", []),
        ("lmstudio", "LM Studio", "http://127.0.0.1:1234/v1", ["chat"], "连接已启动的本地兼容服务；容器部署时请改用宿主机可达地址。", []),
        ("custom", "自定义供应商", "", ["chat", "voice", "image", "decision"], "填写自己的兼容网关、云服务或专用决策地址，可新增多个独立连接。", []),
    ]
    return [
        {
            "id": identifier, "name": name, "base_url": base_url,
            "description": description, "categories": categories,
            "local": identifier in {"ollama", "lmstudio"},
            "requires_key": identifier not in {"ollama", "lmstudio"},
            "models": [{"id": model_id, "name": title, "kind": kind} for model_id, title, kind in models],
        }
        for identifier, name, base_url, categories, description, models in definitions
    ]
