FROM node:16-bullseye-slim

# Evitar preguntas durante la instalación
ENV DEBIAN_FRONTEND=noninteractive

# Instalar Chromium y dependencias
RUN apt-get update \
    && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Configurar Chrome
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROME_PATH=/usr/lib/chromium/
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Crear directorio para archivos estáticos
RUN mkdir -p public

# Exponer puerto
EXPOSE 3000

# Iniciar la aplicación
CMD ["npm", "start"]
