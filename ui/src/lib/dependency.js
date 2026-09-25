/* Runtime desk dependencies.
 *
 * Urbit desks cannot declare another desk as an install dependency. Docket
 * does, however, expose its installed charges and its ordinary install action,
 * so Glurff can offer the missing dependency without owning an installer.
 */
import { api, poke } from 'lib/api';
import { createDependencyWatch } from 'lib/dependency-watch';

export { NOLTBOOK_DESK, NOLTBOOK_PUBLISHER } from 'lib/dependency-state';

export function watchNoltbookDependency({ client = api, send = poke } = {}) {
  return createDependencyWatch({ client, send });
}
