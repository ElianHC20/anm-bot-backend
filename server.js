const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

let sock = null;
let qr = null;
const logger = pino();

// Configurar CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Ruta principal
app.get('/', (req, res) => {
    res.send('ANM Bot Server Running');
});

// Ruta de health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        clientActive: sock !== null,
        websocketConnections: wss.clients.size
    });
});

const createWhatsAppClient = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
    
    const socket = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: logger,
        browser: ['ANM Bot', 'Chrome', '4.0.0']
    });

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr: newQr } = update;

        if (newQr) {
            qr = newQr;
            console.log('QR generado');
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'qr', code: qr }));
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
            console.log('Conectado exitosamente');
            qr = null;
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'ready' }));
                }
            });
        }
    });

    socket.ev.on('creds.update', saveCreds);

    return socket;
};

wss.on('connection', (ws) => {
    console.log('Nueva conexión establecida');

    if (qr) {
        ws.send(JSON.stringify({ type: 'qr', code: qr }));
    }

    if (sock && sock.user) {
        ws.send(JSON.stringify({ type: 'ready' }));
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);

            switch (data.type) {
                case 'start':
                    if (!sock) {
                        try {
                            sock = await createWhatsAppClient();
                        } catch (error) {
                            console.error('Error inicializando cliente:', error);
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                message: 'No se pudo inicializar el cliente' 
                            }));
                        }
                    }
                    break;

                case 'stop':
                    if (sock) {
                        try {
                            sock.end();
                            sock = null;
                        } catch (error) {
                            console.error('Error deteniendo cliente:', error);
                        }
                    }
                    break;

                case 'reset':
                    if (sock) {
                        try {
                            sock.end();
                        } catch (error) {
                            console.error('Error reiniciando cliente:', error);
                        }
                    }
                    sock = await createWhatsAppClient();
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                case 'getState':
                    if (sock && sock.user) {
                        ws.send(JSON.stringify({ type: 'ready' }));
                    } else if (qr) {
                        ws.send(JSON.stringify({ type: 'qr', code: qr }));
                    }
                    break;
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: error.message 
            }));
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado');
    });

    ws.on('error', (error) => {
        console.error('Error en WebSocket:', error);
    });
});

// Manejo de errores globales
process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Promesa rechazada no manejada:', error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
