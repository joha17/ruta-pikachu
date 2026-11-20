// ID de cliente OAuth de Google para la sincronización con Drive.
// Es público: lo ve cualquiera que abra la página, igual que en cualquier sitio con
// «Iniciar sesión con Google». NUNCA pongas aquí el «secreto del cliente»: la app no lo usa.
// Cómo crearlo: README, sección «Sincronizar con Google Drive».
export const CLIENT_ID_IN_CODE = '232316067089-ftos0df51gvp9a3ajqce81tfqpd2ludr.apps.googleusercontent.com';

// Clave de API de Google para LEER los binders que otras personas publican (Siguiendo), sin
// que quien mira inicie sesión. También es pública por diseño: en Google Cloud queda limitada a
// la Google Drive API y a https://joha17.github.io/* (README, «Seguir el binder de otra persona»).
export const DRIVE_API_KEY_IN_CODE = 'AIzaSyD1hADJffzxKv2KCw1eOQmuYal-Bcc7IL0';
