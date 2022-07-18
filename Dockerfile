FROM apify/actor-node-playwright-chrome:16

# Second, copy just package.json and package-lock.json since it should be
# the only file that affects "npm install" in the next step, to speed up the build
COPY package*.json ./

# HACK: we are including dev deps (we need typescript to build), but we don't need it at runtime -> use multistage build
# Install NPM packages, skip optional and development dependencies to
# keep the image small. Avoid logging too much and print the dependency
# tree for debugging
RUN npm --quiet set progress=false \
    && npm install --include=dev --no-optional \
    && echo "Installed NPM packages:" \
    && (npm list --include=dev --no-optional --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Next, copy the remaining files and directories with the source code.
# Since we do this after NPM install, quick build will be really fast
# for most source file changes.
COPY . ./
RUN npm run build

# default CMD
# CMD npm start
