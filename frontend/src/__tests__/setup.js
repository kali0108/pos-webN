import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom doesn't implement these; the app calls them.
Element.prototype.scrollIntoView = () => {};
window.print = () => {};
window.confirm = () => true;
