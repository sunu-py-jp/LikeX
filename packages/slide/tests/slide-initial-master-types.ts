import type { SlideProps, SlideMasterApplication, SlideCommand, SlideDeck } from "../src";
import { applySlideMaster } from "../src";
import { applySlideMaster as applyHeadlessMaster, type SlideMasterApplication as HeadlessApplication } from "../src/model-entry";

declare const deck: SlideDeck;
const application: SlideMasterApplication = { layoutId: "body", layoutsBySlideId: { cover: "title", appendix: null } };
const headless: HeadlessApplication = application;
const props: SlideProps = { initialDeck: deck, initialMaster: application, readOnly: true };
const command: SlideCommand = { type: "deck.applyMaster", ...application };
const result: SlideDeck = applySlideMaster(deck, application).deck;
const headlessResult: SlideDeck = applyHeadlessMaster(deck, headless).deck;
// @ts-expect-error A default layout is required for all-page application.
const missingDefault: SlideMasterApplication = { layoutsBySlideId: { cover: "title" } };
// @ts-expect-error Overrides accept a layout ID or null, not a boolean.
const invalidOverride: SlideMasterApplication = { layoutId: "body", layoutsBySlideId: { cover: false } };
// @ts-expect-error The library is decoded model data, not a remotely fetched URL.
const remoteLibrary: SlideMasterApplication = { layoutId: "body", library: "https://example.test/template.potx" };
void [props, command, result, headlessResult, missingDefault, invalidOverride, remoteLibrary];
