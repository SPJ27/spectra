import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { NextResponse } from "next/server";

/*
add env support
asign port dynamically

*/

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  console.log("running", cmd, args);

  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("__NEXT_") &&
        !key.startsWith("NEXT_") &&
        !key.startsWith("TURBOPACK") &&
        key !== "NODE_APP_INSTANCE",
    ),
  );

  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: {
        ...cleanEnv,
        PATH: process.env.PATH,
        NODE_ENV: process.env.NODE_ENV,
        ...env,
      } as NodeJS.ProcessEnv,
    });

    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`"${cmd}" exited with code ${code}`)),
    );
  });
}

export async function POST(request: Request) {
  const { repo, app_name, domain } = await request.json();

  const target = path.join(process.cwd(), "../deployments", app_name);

  try {
    await run("git", ["clone", repo, target], process.cwd());
  } catch {}

  try {
await run("npm", ["install"], target);
 await run("npm", ["run", "build"], target);
   
await run(
  "pm2",
  ["start", "npm", "--name", app_name, "--", "run", "start"],
  target,
  {
    NODE_ENV: "production",
    PORT: "3001",
  },
);
    const nginxConfig = `
server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:3000;

        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
`;

    await fs.writeFile(`/etc/nginx/conf.d/${domain}.conf`, nginxConfig, "utf8");

    await run("sudo", ["nginx", "-t"], process.cwd());
    await run("sudo", ["systemctl", "reload", "nginx"], process.cwd());

    return NextResponse.json({
      message: "Repository created successfully!",
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        message: err instanceof Error ? err.message : "Unknown error occurred",
      },
      {
        status: 500,
      },
    );
  }
}
