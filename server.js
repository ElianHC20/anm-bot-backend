const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

let client = null;
let qr = null;

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
        clientActive: client !== null,
        websocketConnections: wss.clients.size
    });
});

const createWhatsAppClient = () => {
    const client = new Client({
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--no-first-run',
                '--single-process',
                '--no-zygote'
            ]
        }
    });

    client.on('qr', (code) => {
        qr = code;
        console.log('Nuevo código QR generado');
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'qr', code: qr }));
            }
        });
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('Cliente WhatsApp listo');
        qr = null;
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'ready' }));
            }
        });
    });

    client.on('authenticated', () => {
        console.log('Cliente autenticado');
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'authenticated' }));
            }
        });
    });

    client.on('disconnected', (reason) => {
        console.log('Cliente WhatsApp desconectado:', reason);
        qr = null;
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ 
                    type: 'disconnected',
                    reason: reason 
                }));
            }
        });
    });

    // Añade manejo de errores específicos
    client.on('auth_failure', (msg) => {
        console.error('Error de autenticación:', msg);
        qr = null;
        wss.clients.forEach((wsClient) => {
            if (wsClient.readyState === WebSocket.OPEN) {
                wsClient.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Error de autenticación' 
                }));
            }
        });
    });

    // Evento de error más detallado
    client.on('error', (err) => {
        console.error('Error crítico del cliente:', err);
        qr = null;
        
        // Intenta destruir el cliente de manera segura
        try {
            if (client && typeof client.destroy === 'function') {
                client.destroy();
            }
        } catch (destroyError) {
            console.error('Error al destruir el cliente:', destroyError);
        }

        wss.clients.forEach((wsClient) => {
            if (wsClient.readyState === WebSocket.OPEN) {
                wsClient.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Error crítico del cliente WhatsApp' 
                }));
            }
        });
    });

    return client;
};

wss.on('connection', (ws) => {
    console.log('Nueva conexión establecida');

    if (qr) {
        ws.send(JSON.stringify({ type: 'qr', code: qr }));
    }

    if (client && client.info) {
        ws.send(JSON.stringify({ type: 'ready' }));
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);

            switch (data.type) {
                case 'start':
                    if (!client) {
                        client = createWhatsAppClient();
                        try {
                            await client.initialize();
                        } catch (initError) {
                            console.error('Error inicializando cliente:', initError);
                            client = null;
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                message: 'No se pudo inicializar el cliente' 
                            }));
                        }
                    }
                    break;

                case 'stop':
                    if (client) {
                        try {
                            await client.destroy();
                        } catch (destroyError) {
                            console.error('Error al detener cliente:', destroyError);
                        }
                        client = null;
                        qr = null;
                    }
                    break;

                case 'reset':
                    if (client) {
                        try {
                            await client.destroy();
                        } catch (destroyError) {
                            console.error('Error al reiniciar cliente:', destroyError);
                        }
                    }
                    client = createWhatsAppClient();
                    try {
                        await client.initialize();
                    } catch (initError) {
                        console.error('Error reinicializando cliente:', initError);
                        client = null;
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: 'No se pudo reiniciar el cliente' 
                        }));
                    }
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                case 'getState':
                    if (client && client.info) {
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
