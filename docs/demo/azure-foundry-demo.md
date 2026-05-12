# Azure Foundry Demo Output

Dataset: [PolyAI/minds14](https://huggingface.co/datasets/PolyAI/minds14) (cc-by-4.0)

Model: gpt-5.5-2026-04-24

Generated at: 2026-05-12T05:19:36.991Z

## Summary

- Calls processed: 4
- Events emitted: 38
- Human handoffs: 1

## Calls

| Call | Intent | Queue | Handoff | Events | Post-call summary |
| --- | --- | --- | --- | ---: | --- |
| call_minds14_1 | Open a joint bank account with a partner | account_opening | no | 9 | caller: I would like to set up a joint account with my partner | assistant: You can start a joint account in the secure app or at a branch. Both applicants will need ID and must provide consent. |
| call_minds14_2 | Open a joint bank account with spouse and find where to do it | account_opening | no | 9 | caller: Henry County set up a joint account with my wife and where are they at | assistant: For a joint account with your wife, please use the branch locator to find a nearby account-opening branch in Henry County. |
| call_minds14_3 | Request help opening a joint account by phone | account_opening_specialist | yes | 11 | caller: hi I'd like to set up a joint account with my partner I'm not seeing the option to do it on the app so I called in to get some help can I do it over the phone with you and give you the information | assistant: I’ll connect you with an account-opening specialist who can explain the next steps and handle any required identity checks. |
| call_minds14_4 | Ask how to start a joint bank account | account_opening | no | 9 | caller: how do I start a joint account | assistant: To start, choose the account type, have both applicants’ IDs ready, then apply in the secure app or visit a branch. |

## Event Counts

```json
{
  "call.closed": 4,
  "call.closing": 4,
  "handoff.accepted": 1,
  "handoff.requested": 1,
  "latency.marker": 8,
  "postcall.ready": 4,
  "tool.call": 4,
  "tool.result": 4,
  "transcript.final": 8
}
```
