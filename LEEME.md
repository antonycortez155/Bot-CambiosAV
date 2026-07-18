# Cambios AV — Bot Lite

Copia liviana del bot para **servidor 24/7** con **~1 GB RAM**.  
Usa la **misma base de datos Supabase** que tu bot principal.  
El proyecto original en `Documents\BOT CAMBIOS AV` **no se modifica**.

## Qué hace (completo)

- Cotizaciones rápidas e inversas  
- Flujo de envío + comprobantes  
- Estado / historial  
- Menú fallback (1 vez cada 6 h)  
- Handoff a asesor  
- Difusiones (más espaciadas)  
- Health check + auto-reinicio  
- Limpieza diaria a las **02:00 hora Venezuela**

## Qué se recortó (para ahorrar RAM)

- Estados / stories de WhatsApp (`estados.js`)  
- `getLatestVersion` (menos overhead al arrancar)  
- Heap Node 384 MB / Chrome más agresivo  
- Difusiones cada 5 min (máx. 2 por ciclo)  
- Cachés y mapas más pequeños  

## Arranque local

```bat
npm install
npm start
```

La primera vez escanearás un **QR** (sesión distinta: `cambios-ayv-lite`).  
No uses el mismo WhatsApp a la vez que el bot completo.

## Servidor 24/7 (recomendado: PM2)

```bash
npm install
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

PM2 reinicia si el proceso cae o supera ~700 MB RSS.

## Variables

Copia el mismo `.env` (ya incluido desde tu proyecto).  
Misma `SUPABASE_URL` / `SUPABASE_KEY` / admins.

## Nota

No ejecutes Lite y el bot completo con el **mismo número** al mismo tiempo (conflicto de sesión WhatsApp).
