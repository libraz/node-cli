// npm-check-updates configuration.
//
// TypeScript 7 ships the native (Go) compiler with a different package
// layout, which Yarn's built-in TypeScript PnP patch cannot apply. Hold the
// dependency on the 6.x line until the toolchain supports the native build.
module.exports = {
  reject: ["typescript"],
};
