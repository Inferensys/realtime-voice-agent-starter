# Demo Assets

This directory contains the Azure Foundry demo output committed for the README.

## Source

- Dataset: [PolyAI/minds14](https://huggingface.co/datasets/PolyAI/minds14)
- Config: `en-US`
- Split: `train`
- License: `cc-by-4.0`
- Sample size: 4 calls

## Model

- Azure Foundry deployment used for this run: `gpt-5.5`
- Response model reported by API: see `azure-foundry-demo.json`

## Files

- `dataset/minds14-en-us-sample.json`: downloaded row metadata
- `dataset/audio/*.wav`: small downloaded audio clips for the sampled calls
- `output/replays.json`: server replay output
- `azure-foundry-demo.json`: full demo record
- `azure-foundry-demo.md`: human-readable output
- `screenshots/*.png`: README screenshots
- `realtime-voice-agent-demo.mp4`: short generated walkthrough video

## Re-run

```bash
AZURE_AI_RESOURCE_GROUP=<resource-group> \
AZURE_AI_RESOURCE_NAME=<foundry-resource-name> \
OPENAI_BASE_URL=https://<resource>.services.ai.azure.com/openai/v1 \
OPENAI_MODEL=gpt-5.5 \
npm run demo:azure
```

The script does not write keys to disk.
