FROM node:20-alpine

WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Remove yarn.lock se existir e instala com npm
RUN if [ -f yarn.lock ]; then rm yarn.lock; fi && npm install

# Copia o resto do código
COPY . .

# Gera o build
RUN npm run build

# Expõe a porta
EXPOSE 3000

# Inicia o servidor
CMD ["npm", "run", "start:dev"]