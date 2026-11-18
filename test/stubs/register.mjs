// Redirect Forge runtime packages to in-memory stubs so the backend runs under plain Node.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
