import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { NextResponse } from "next/server";

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
        key !== "NODE_APP_INSTANCE" &&
        key !== "NODE_OPTIONS" &&
        key !== "NODE_ENV",
    ),
  );
  console.log("Parent NODE_ENV =", process.env.NODE_ENV);
  console.log("Child NODE_ENV =", cleanEnv.NODE_ENV);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: {
        ...cleanEnv,
        PATH: process.env.PATH,
        ...env,
      } as unknown as NodeJS.ProcessEnv,
    });

    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`"${cmd}" exited with code ${code}`)),
    );
  });
}

async function pathExists(p: string) {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
}


function toEnvFile(env: unknown): string {
  if (typeof env === "string") return env;
  if (env && typeof env === "object") {
    return Object.entries(env as Record<string, string>)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
  }
  return "";
}

export async function POST(request: Request) {
  const { repo, app_name, domain, env, port } = await request.json();
  const target = path.join(process.cwd(), "../deployments", app_name);
  const appPort = port || "3001";

  try {
    await run("git", ["clone", repo, target], process.cwd());
  } catch {}

  try {
    await fs.rm(path.join(target, "node_modules"), { recursive: true, force: true });
    await fs.rm(path.join(target, ".next"), { recursive: true, force: true });

    const hasLockfile = await pathExists(path.join(target, "package-lock.json"));
    await fs.writeFile(path.join(target, ".env"), toEnvFile(env), "utf8");

    if (hasLockfile) {
      await run("npm", ["ci"], target);
    } else {
      await run("npm", ["install"], target);
    }

    await run("npm", ["run", "build"], target);

    await run(
      "pm2",
      ["start", "npm", "--name", app_name, "--", "run", "start"],
      target,
      { NODE_ENV: "production", PORT: appPort },
    );

    const nginxConfig = `
server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${appPort};

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
    await run("nginx", ["-t"], process.cwd());
    await run("systemctl", ["reload", "nginx"], process.cwd());

    return NextResponse.json({
      message: "Repository deployed successfully! Please add a DNS record pointing to this server for your domain.",
      domain,
      port: appPort,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Unknown error occurred" },
      { status: 500 },
    );
  }
}