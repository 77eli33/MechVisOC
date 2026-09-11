import { useEffect, useRef } from "react";

const vertexShaderSource = `
  attribute vec2 a_position;
  void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fragmentShaderSource = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;

  float field(vec2 p, float time) {
    float first = sin(p.x * 1.25 + sin(p.y * 0.9 - time * 0.72) * 1.18 + time);
    float second = sin(p.y * 1.48 + cos(p.x * 0.82 + time * 0.5) * 1.36 - time * 0.55);
    float third = sin((p.x + p.y) * 0.73 - time * 0.36);
    return (first + second + third) / 3.0;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0) * 3.0;
    float time = u_time * 0.075;
    float broad = field(p, time);
    float cross = field(p.yx * vec2(-0.72, 0.86) + 0.8, -time * 0.63);
    float light = smoothstep(-0.7, 0.62, broad + cross * 0.48);
    float shadow = smoothstep(-0.1, 0.82, -broad + cross * 0.34);
    vec3 ice = vec3(0.73, 0.79, 0.82);
    vec3 slate = vec3(0.38, 0.48, 0.50);
    vec3 teal = vec3(0.10, 0.34, 0.36);
    vec3 graphite = vec3(0.13, 0.20, 0.21);
    vec3 color = mix(slate, ice, light);
    color = mix(color, teal, smoothstep(-0.35, 0.76, cross) * 0.82);
    color = mix(color, graphite, shadow * 0.38);
    float vignette = smoothstep(1.14, 0.2, length(uv - 0.5));
    color *= mix(0.88, 1.05, vignette);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", {
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    if (!canvas || !gl) return;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const time = gl.getUniformLocation(program, "u_time");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const draw = (timestamp: number) => {
      resize();
      gl.useProgram(program);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, reducedMotion ? 0 : timestamp / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }, []);

  return <canvas ref={canvasRef} className="shader-background" aria-hidden="true" />;
}
