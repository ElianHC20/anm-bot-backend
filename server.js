const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const makeWASocket = require('@adiwajshing/baileys').default;
const { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@adiwajshing/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

let client = null;
let qr = null;
const logger = pino({ level: 'silent' });

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.get('/', (req, res) => {
    res.send('ANM Bot Server Running');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        clientActive: client !== null,
        websocketConnections: wss.clients.size
    });
});

const createWhatsAppClient = async () => {
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
        
        const sock = makeWASocket({
            version,
            printQRInTerminal: true,
            auth: state,
            logger: logger,
            browser: ['ANM Bot', 'Chrome', '4.0.0'],
            generateHighQualityLinkPreview: true
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr: newQr } = update;

            console.log('Conexión actualizada:', update);

            if (newQr) {
                qr = newQr;
                console.log('Nuevo QR generado');
                
                // Broadcast QR a todos los clientes WebSocket
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ 
                            type: 'qr', 
                            code: qr 
                        }));
                    }
                });

                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const shouldReconnect = 
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                console.log('Conexión cerrada. Reconectando:', shouldReconnect);
                
                if (shouldReconnect) {
                    await createWhatsAppClient();
                }
            }

            if (connection === 'open') {
                console.log('Cliente WhatsApp conectado');
                qr = null;
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'ready' }));
                    }
                });
            }
        });

        sock.ev.on('creds.update', saveCreds);

        return sock;
    } catch (error) {
        console.error('Error creando cliente:', error);
        throw error;
    }
};

wss.on('connection', (ws) => {
    console.log('Nueva conexión WebSocket establecida');

    // Si hay QR pendiente, enviarlo
    if (qr) {
        ws.send(JSON.stringify({ type: 'qr', code: qr }));
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);

            switch (data.type) {
                case 'start':
                    if (!client) {
                        client = await createWhatsAppClient();
                    }
                    break;

                case 'stop':
                    if (client) {
                        await client.logout();
                        client = null;
                        qr = null;
                    }
                    break;

                case 'reset':
                    if (client) {
                        await client.logout();
                    }
                    client = await createWhatsAppClient();
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                case 'getState':
                    if (client && client.user) {
                        ws.send(JSON.stringify({ type: 'ready' }));
                    } else if (qr) {
                        ws.send(JSON.stringify({ type: 'qr', code: qr }));
                    }
                    break;
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
    });
});

process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Promesa rechazada:', error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
