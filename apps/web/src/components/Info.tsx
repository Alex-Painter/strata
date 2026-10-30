import { Icon } from "./Icon";

/**
 * An info icon next to a heading. Its text explains the section, and shows
 * on hover or focus, so that the explanation does not take space on the page.
 */
export function Info({ text }: { text: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: focus shows the text to keyboard users.
    <span className="info" role="img" aria-label={text} data-tip={text} tabIndex={0}>
      <Icon name="info" />
    </span>
  );
}
