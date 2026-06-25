#!/bin/bash

set -e

DOMAIN="$1"

CONFIG_FILE="/etc/nginx/conf.d/${DOMAIN}.conf"

apt update
apt install -y git nginx nodejs npm

npm install -g pm2

if [ ! -d "spectra" ]; then
git clone https://github.com/SPJ27/spectra.git
fi

cd spectra

git pull

npm install
npm run build

pm2 delete spectra 2>/dev/null || true

PORT=3000 pm2 start npm 
--name spectra 
-- start

cat > "$CONFIG_FILE" <<EOF
server {
listen 80;
server_name ${DOMAIN};

```
location / {
    proxy_pass http://127.0.0.1:3000;

    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}
```

}
EOF

nginx -t
systemctl reload nginx

pm2 save

echo "Spectra deployed successfully at ${DOMAIN}"
