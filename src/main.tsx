import '@fontsource/bricolage-grotesque/latin-500.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import '@fontsource/figtree/latin-400.css';
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-600.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles/ruta.css';
import './styles/app.css';
import { render } from 'preact';
import { App } from './App';
import { wirePriceUpdates } from './prices';
import { boot } from './store';

render(<App />, document.getElementById('app')!);
// Al terminar de abrir la colección: precios del día (una vez al día, nunca en bucle).
void boot().then(wirePriceUpdates);
