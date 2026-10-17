/**
 * The splash (index.html): the logo on the night sky, shown when the site opens at its home page. It stays at least
 * MIN_MS from the start of the page's load, until the home page has its first posts, then fades out.
 */
const MIN_MS = 3000;
/** Whatever happens (a slow network, an error), it goes after this. */
const MAX_MS = 10_000;

let leaving = false;

/** Takes the splash away (once MIN_MS have passed); does nothing where there's none. */
export function hideSplash() {
  const splash = document.getElementById('splash');
  if (leaving || !splash) return;
  leaving = true;
  window.setTimeout(() => {
    const remove = () => {
      document.documentElement.classList.remove('splash');
      splash.remove();
    };
    splash.addEventListener('animationend', (event) => event.target === splash && remove());
    splash.classList.add('is-leaving');
    window.setTimeout(remove, 700); // with reduced motion there's no fade to wait for
  }, Math.max(0, MIN_MS - performance.now()));
}

/** The safety net, set once when the app starts. */
export function hideSplashLater() {
  window.setTimeout(hideSplash, Math.max(0, MAX_MS - performance.now()));
}
