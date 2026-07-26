/** Tiny classname joiner — avoids a dependency for the one thing we need. */
export const clsx = (...parts) => parts.filter(Boolean).join(' ')
