# 1. Pick a base image
FROM node:slim

# 2. Set working dir
WORKDIR /app

# 3. Copy package files & install deps
COPY package*.json ./
RUN npm ci --only=production
# 4. Copy the rest of your code
COPY . .

# 5. Expose the port your app runs on
EXPOSE 5001

# 6. Start the app
CMD ["node", "index.js"]