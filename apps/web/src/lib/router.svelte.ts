/**
 * Hash router. Deliberately tiny — there are only a handful of routes and a
 * router dependency would outweigh the app it routes.
 */
export type Route = 'game' | 'settings' | 'leaderboard' | 'profile';

const ROUTES: readonly Route[] = ['game', 'settings', 'leaderboard', 'profile'];

function current(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(hash) ? (hash as Route) : 'game';
}

export const router = $state<{ route: Route }>({ route: current() });

export function navigate(route: Route): void {
  location.hash = `#/${route}`;
}

export function initRouter(): void {
  addEventListener('hashchange', () => {
    router.route = current();
  });
}
