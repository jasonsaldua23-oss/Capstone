import assert from "node:assert/strict";
import { test } from "node:test";

// The helper is pure and must not pull in react-native, so it is safe to exercise
// under `node --test` the same way customer-logic is.
import { boxShadow } from "../styles/shadow.ts";

test("boxShadow renders the authCard shadow with an alpha channel", () => {
  assert.deepEqual(
    boxShadow({ color: "#0f435e", opacity: 0.12, radius: 23, offsetY: 18 }),
    { boxShadow: "0px 18px 23px rgba(15, 67, 94, 0.12)" }
  );
});

test("boxShadow keeps the 1:1 radius mapping react-native-web used internally", () => {
  const { boxShadow: value } = boxShadow({ color: "#101828", opacity: 0.08, radius: 20, offsetY: 8 });
  assert.equal(value, "0px 8px 20px rgba(16, 24, 40, 0.08)");
});

test("boxShadow expands three-digit hex", () => {
  assert.equal(boxShadow({ color: "#fff", opacity: 0.5, radius: 4, offsetY: 1 }).boxShadow, "0px 1px 4px rgba(255, 255, 255, 0.5)");
});

test("boxShadow falls back to the authored colour when it is not hex", () => {
  assert.equal(boxShadow({ color: "rebeccapurple", opacity: 0.3, radius: 2, offsetY: 1 }).boxShadow, "0px 1px 2px rebeccapurple");
});

test("boxShadow honours a horizontal offset when one is given", () => {
  assert.equal(boxShadow({ color: "#000000", opacity: 1, radius: 0, offsetY: 2, offsetX: -3 }).boxShadow, "-3px 2px 0px rgba(0, 0, 0, 1)");
});
