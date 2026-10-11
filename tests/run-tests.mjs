import assert from "node:assert/strict";
import { getMisfireProfile, sanitizeFeatureValue } from "../scripts/firearm-data.js";
import { calculatePowderMishapResult } from "../scripts/firearm-rules.js";
import { FIREARM_FEATURES } from "../scripts/constants.js";

class FakeItem {
  constructor(flags = {}) { this.flags = flags; }
  getFlag(_scope, key) { return this.flags[key]; }
}

const profile = flags => getMisfireProfile(new FakeItem(flags));
assert.equal(profile({}).primaryFormula, "1d20");
assert.equal(profile({ feat_Fickle: true }).primaryFormula, "1d10");
assert.equal(profile({ feat_Faultless: true }).primaryFormula, null);
assert.deepEqual(
  { primary: profile({ feat_Kamora: true }).primaryFormula, kamora: profile({ feat_Kamora: true }).kamoraFormula },
  { primary: null, kamora: "1d12" }
);
assert.equal(profile({ feat_Kamora: true, feat_Fickle: true }).kamoraFormula, "1d6");
assert.equal(profile({ feat_Kamora: true, feat_Faultless: true }).kamoraFormula, "1d12");

assert.equal(calculatePowderMishapResult(1, { reliable: true }).finalResult, 6);
assert.equal(calculatePowderMishapResult(4, { thickened: true }).finalResult, 5);
assert.equal(calculatePowderMishapResult(4, { thinned: true }).finalResult, 3);
assert.equal(calculatePowderMishapResult(2, { risky: true }).finalResult, 1);
assert.equal(calculatePowderMishapResult(2, { thickened: true, risky: true }).finalResult, 1);
assert.equal(calculatePowderMishapResult(4, { thickened: true, thinned: true }).finalResult, 4);

const range = FIREARM_FEATURES.find(feature => feature.key === "Range");
assert.equal(sanitizeFeatureValue(range, "12"), "12");
assert.equal(sanitizeFeatureValue(range, "abc"), "");
assert.equal(sanitizeFeatureValue(range, "-2"), "0");

console.log("FL Firearms domain tests: OK");
