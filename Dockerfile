########################################
# === Dockerfile: Node/Express App ====#
########################################

# 1. Base: official Node 18 (slim)
# FROM node:18-slim - this give me a vulnerability warning
FROM node:slim 

# 2. Create app directory
WORKDIR /usr/src/app

# 3. Copy only package.json & package-lock.json
COPY package*.json ./

# 4. Install dependencies (production only)
RUN npm install --only=production

# 5. Copy source code
COPY . .

# 6. Expose the port your Express listens on
EXPOSE 5001

# 7. Run the app
CMD ["npm", "start"]
