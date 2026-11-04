# RetroTV para Kino

Plugin experimental para reunir dentro de Kino los catálogos de:
- https://www.frikiserie.com/
- https://seriesretro.com/

## Instalación
En Kino: **Ajustes → Plugins**, escribe `Moonspell075/retrotv-kino`, revisa los permisos y confirma solo si estás de acuerdo.

## Qué incluye esta primera versión
- Dos filas de catálogo en Inicio.
- Búsqueda en ambas fuentes.
- Fichas y extracción de enlaces de episodios.
- Intento de reproducción en el reproductor nativo mediante la captura del reproductor de la página del episodio.

## Importante
Esta versión inicial requiere pruebas reales dentro de Kino en Android/Android TV. Las páginas pueden cambiar sus rutas, estructura o reproductores; por eso no se garantiza todavía que todos los títulos o servidores funcionen. Si un sitio requiere intervención humana, autenticación o presenta DRM, el plugin no intenta eludirlo. La reproducción depende de que Kino detecte un stream compatible y autorizado.

## Archivos
- `kino-plugin.json`: manifiesto y permisos declarados.
- `plugin.js`: catálogo, búsqueda, episodios y resolución.
