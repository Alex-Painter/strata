/** Test helpers for packages that drive the engine: real git repos and a fake GitHub. */
export { type DemoRepo, demoRepo } from "./demo-repo.js";
export {
  type FakeGitHub,
  fakeGitHub,
  forcePushed,
  ghTime,
  prNode,
  retargeted,
} from "./fake-github.js";
export { StackRepo } from "./stack-repo.js";
