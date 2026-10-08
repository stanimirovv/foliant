import { parseViewsData } from './src/lib/views.js';
import * as fs from 'fs';

const code = fs.readFileSync('diagrams/main.mmd', 'utf8');
const parsed = parseViewsData(code);
console.log(JSON.stringify(parsed, null, 2));
