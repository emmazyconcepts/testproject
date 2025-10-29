"use client";

import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import { Device } from "mediasoup-client";

export default function index() {
  const WS_URL = "wss://api-dev.skite.co/mediasoup";
  const ROOM_ID = "session_68fb900f3f9458d711d01b00";

  const [socket, setSocket] = useState(null);
  const [joined, setJoined] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState("");
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [connectionState, setConnectionState] = useState("disconnected");
  const [transportState, setTransportState] = useState("disconnected");
  const [debugInfo, setDebugInfo] = useState({});
  const [iceConnectionState, setIceConnectionState] = useState("");
  const [signalingState, setSignalingState] = useState("");

  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const producersRef = useRef(new Set());
  const consumersRef = useRef(new Set());
  const producedTracksRef = useRef(new Set());
  const consumingProducersRef = useRef(new Set());
  const localVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);

  useEffect(() => {
    initializeSocket();
    startDebugMonitoring();

    return () => {
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Debug monitoring
  const startDebugMonitoring = () => {
    setInterval(() => {
      updateDebugInfo();
    }, 2000);
  };

  const updateDebugInfo = () => {
    const info = {
      timestamp: new Date().toISOString(),
      socket: {
        connected: socketRef.current?.connected,
        id: socketRef.current?.id,
      },
      device: {
        loaded: !!deviceRef.current,
        rtpCapabilities: !!deviceRef.current?.rtpCapabilities,
      },
      transports: {
        send: !!sendTransportRef.current,
        recv: !!recvTransportRef.current,
        sendState: sendTransportRef.current?.connectionState,
        recvState: recvTransportRef.current?.connectionState,
      },
      streams: {
        local: !!localStream,
        localTracks: localStream ? localStream.getTracks().length : 0,
        remote: Object.keys(remoteStreams).length,
      },
      producers: {
        count: producersRef.current.size,
        list: Array.from(producersRef.current),
      },
      consumers: {
        count: consumersRef.current.size,
        consuming: consumingProducersRef.current.size,
      },
      network: {
        iceState: iceConnectionState,
        signalingState: signalingState,
      },
    };
    setDebugInfo(info);
  };

  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
    }
    if (recvTransportRef.current) {
      recvTransportRef.current.close();
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  // WebRTC Connection Tests
  const testWebRTCSupport = () => {
    const tests = {
      getUserMedia: !!navigator.mediaDevices?.getUserMedia,
      RTCPeerConnection: !!window.RTCPeerConnection,
      RTCSessionDescription: !!window.RTCSessionDescription,
      RTCIceCandidate: !!window.RTCIceCandidate,
      audioDevices: false,
      videoDevices: false,
    };

    // Test device enumeration
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      tests.audioDevices = devices.some((d) => d.kind === "audioinput");
      tests.videoDevices = devices.some((d) => d.kind === "videoinput");
      setDebugInfo((prev) => ({ ...prev, webrtcTests: tests }));
    });

    return tests;
  };

  const testNetworkConnectivity = async () => {
    const tests = {
      websocket: false,
      stun: true,
      turn: false,
      initialWebSocket: true,
    };

    // Test WebSocket with better error handling
    try {
      const wsTest = new WebSocket(WS_URL);

      await new Promise((resolve, reject) => {
        let resolved = false;

        wsTest.onopen = () => {
          if (!resolved) {
            resolved = true;
            tests.websocket = true;
            resolve(true);
          }
        };

        wsTest.onerror = (error) => {
          if (!resolved) {
            resolved = true;
            console.log(
              "WebSocket test failed (expected if initial connection worked):",
              error
            );
            resolve(false);
          }
        };

        // Short timeout since we just want to test connectivity
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log("WebSocket test timeout (might be normal)");
            resolve(false);
          }
        }, 3000);
      });

      wsTest.close();
    } catch (e) {
      console.log("WebSocket test exception (might be normal):", e.message);
    }

    // Test STUN server (this is critical for WebRTC)
    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      await pc.createOffer();
      tests.stun = true;
      pc.close();
    } catch (e) {
      console.error("STUN test failed:", e);
      tests.stun = false;
    }

    setDebugInfo((prev) => ({ ...prev, networkTests: tests }));
    return tests;
  };

  const getDetailedTransportStats = async () => {
    if (!sendTransportRef.current) return null;

    try {
      const stats = {
        iceConnectionState: sendTransportRef.current.connectionState,
        iceGatheringState: "unknown",
        signalingState: "unknown",
        candidates: {
          local: 0,
          remote: 0,
        },
      };

      console.log("Transport stats:", stats);
      return stats;
    } catch (error) {
      console.error("Error getting transport stats:", error);
      return null;
    }
  };

  const testMediaDevices = async () => {
    const results = {
      audio: { available: false, constraints: {} },
      video: { available: false, constraints: {} },
    };

    try {
      // Test audio
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      results.audio.available = true;
      results.audio.constraints =
        audioStream.getAudioTracks()[0]?.getSettings() || {};
      audioStream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      results.audio.error = e.message;
    }

    try {
      // Test video
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
      results.video.available = true;
      results.video.constraints =
        videoStream.getVideoTracks()[0]?.getSettings() || {};
      videoStream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      results.video.error = e.message;
    }

    setDebugInfo((prev) => ({ ...prev, mediaTests: results }));
    return results;
  };

  const runComprehensiveDiagnostics = async () => {
    console.log("🚀 Running comprehensive WebRTC diagnostics...");

    const diagnostics = {
      webrtcSupport: testWebRTCSupport(),
      networkTests: await testNetworkConnectivity(),
      mediaTests: await testMediaDevices(),
      transportStats: await getDetailedTransportStats(),
      currentState: {
        connectionState,
        transportState,
        joined,
        localStream: !!localStream,
        remoteStreams: Object.keys(remoteStreams).length,
      },
    };

    console.log("📊 Diagnostics results:", diagnostics);
    setDebugInfo((prev) => ({ ...prev, diagnostics }));

    const summary = `
WebRTC Support: ${diagnostics.webrtcSupport.getUserMedia ? "✅" : "❌"}
Network: WebSocket ${diagnostics.networkTests.websocket ? "✅" : "❌"}, STUN ${
      diagnostics.networkTests.stun ? "✅" : "❌"
    }
Media: Audio ${diagnostics.mediaTests.audio.available ? "✅" : "❌"}, Video ${
      diagnostics.mediaTests.video.available ? "✅" : "❌"
    }
Connection: ${connectionState}, Transport: ${transportState}
    `.trim();

    alert(`Diagnostics Results:\n${summary}`);
    return diagnostics;
  };

  const initializeSocket = () => {
    const s = io(WS_URL, {
      path: "/socket.io",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    setSocket(s);
    socketRef.current = s;
    setConnectionState("connecting");

    s.on("connect", () => {
      console.log("✅ Connected:", s.id);
      setConnectionState("connected");
      s.emit("joinRoom", { roomName: ROOM_ID });
      updateDebugInfo();
    });

    s.on("disconnect", (reason) => {
      console.warn("⚠️ Disconnected:", reason);
      setConnectionState("disconnected");
      setTransportState("disconnected");
      updateDebugInfo();
    });

    s.on("connect_error", (error) => {
      console.error("❌ Connection error:", error);
      setConnectionState("error");
      updateDebugInfo();
    });

    s.on("joinedRoom", (res) => {
      console.log("🎉 Joined room:", res);
      const rtpCaps = res?.rtpCapabilities;
      if (!rtpCaps) {
        console.error("❌ No rtpCapabilities found");
        return;
      }
      loadDevice(rtpCaps);
      setJoined(true);
      updateDebugInfo();
    });

    s.on("producerList", (list) => {
      console.log("📋 Producer list received:", list);
      if (list && list.length > 0) {
        list.forEach((producerId) => {
          if (producerId && !producersRef.current.has(producerId)) {
            console.log("👀 Found existing producer:", producerId);
            producersRef.current.add(producerId);
            setTimeout(() => {
              if (recvTransportRef.current) {
                consume(producerId);
              }
            }, 2000);
          }
        });
      } else {
        console.log("📭 No producers in room yet");
      }
      updateDebugInfo();
    });

    s.on("newProducer", (producerId) => {
      console.log("🆕 New producer event:", producerId);
      if (producerId && !producersRef.current.has(producerId)) {
        producersRef.current.add(producerId);
        setTimeout(() => {
          if (recvTransportRef.current) {
            consume(producerId);
          }
        }, 1000);
      }
      updateDebugInfo();
    });

    s.on("producerClosed", (producerId) => {
      console.log("🗑️ Producer closed:", producerId);
      producersRef.current.delete(producerId);
      consumingProducersRef.current.delete(producerId);
      setRemoteStreams((prev) => {
        const newStreams = { ...prev };
        delete newStreams[producerId];
        return newStreams;
      });
      updateDebugInfo();
    });

    s.on("consumed", async (data) => {
      console.log("🎥 Consumed event received:", data);
      if (!data || !recvTransportRef.current) {
        console.error("❌ No data or receive transport not ready");
        return;
      }

      const { id, kind, rtpParameters, producerId } = data;

      if (consumingProducersRef.current.has(producerId)) {
        console.log("⏩ Already consuming from producer:", producerId);
        return;
      }

      try {
        console.log("🔄 Creating consumer for:", kind, "producer:", producerId);

        const consumer = await recvTransportRef.current.consume({
          id,
          producerId,
          kind,
          rtpParameters,
        });

        console.log(
          "✅ Consumer created:",
          consumer.id,
          "for producer:",
          producerId
        );

        consumingProducersRef.current.add(producerId);
        consumersRef.current.add(consumer.id);

        const stream = new MediaStream();
        stream.addTrack(consumer.track);

        setRemoteStreams((prev) => ({
          ...prev,
          [producerId]: stream,
        }));

        console.log("🎬 Remote stream added for producer:", producerId);

        try {
          await consumer.resume();
          console.log("▶️ Consumer resumed");
        } catch (resumeError) {
          console.error("❌ Error resuming consumer:", resumeError);
        }
      } catch (error) {
        console.error("❌ Error creating consumer:", error);
        consumingProducersRef.current.delete(producerId);
      }
      updateDebugInfo();
    });

    s.on("chatMessage", (message) => {
      console.log("💬 Chat message:", message);
      if (message) {
        setMessages((prev) => [...prev, message]);
      }
    });

    s.on("error", (error) => {
      console.error("❌ Socket error:", error);
      if (error?.message?.includes("room is full")) {
        alert("Room is full (max 2 participants). Please try another room.");
      }
      updateDebugInfo();
    });

    setSocket(s);
  };

  async function loadDevice(rtpCaps) {
    try {
      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCaps });
      deviceRef.current = device;
      console.log(
        "✅ Device loaded with capabilities:",
        device.rtpCapabilities
      );
      updateDebugInfo();
    } catch (e) {
      console.error("❌ Device load error:", e);
      updateDebugInfo();
    }
  }

  async function createSendTransport() {
    return new Promise((resolve, reject) => {
      console.log("🛠️ Creating send transport...");

      if (!socketRef.current) {
        reject("Socket not available");
        return;
      }

      const timeout = setTimeout(() => {
        reject("Timeout creating send transport");
      }, 10000);

      socketRef.current.off("createWebRtcTransportSuccess");
      socketRef.current.off("createWebRtcTransportError");

      socketRef.current.emit("createWebRtcTransport", {
        consumer: false,
        forceTcp: false,
      });

      socketRef.current.once("createWebRtcTransportSuccess", (data) => {
        clearTimeout(timeout);
        console.log("📦 Send transport created:", data);

        if (!data || !deviceRef.current) {
          reject("No transport data or device not ready");
          return;
        }

        try {
          const transport = deviceRef.current.createSendTransport({
            id: data.id,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            dtlsParameters: data.dtlsParameters,
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
              { urls: "stun:stun2.l.google.com:19302" },
            ],
          });

          transport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
              try {
                console.log("🔌 Connecting send transport...");
                socketRef.current.emit("transport-connect", {
                  serverTransportId: data.id,
                  dtlsParameters,
                });

                const connectTimeout = setTimeout(() => {
                  console.log("✅ Send transport connected (timeout fallback)");
                  callback();
                }, 1000);

                socketRef.current.once("transport-connected", () => {
                  clearTimeout(connectTimeout);
                  console.log("✅ Send transport connected (server confirmed)");
                  callback();
                });
              } catch (error) {
                console.error("❌ Transport connect error:", error);
                errback(error);
              }
            }
          );

          transport.on("produce", async (params, callback, errback) => {
            try {
              console.log("🎬 Producing track:", params.kind);

              socketRef.current.emit("transport-produce", {
                kind: params.kind,
                rtpParameters: params.rtpParameters,
                appData: params.appData,
                serverTransportId: data.id,
              });

              const producedTimeout = setTimeout(() => {
                console.warn("⚠️ Produce timeout, using fallback");
                callback({ id: `fallback-${params.kind}-${Date.now()}` });
              }, 5000);

              socketRef.current.once("produced", (response) => {
                clearTimeout(producedTimeout);
                console.log("✅ Server acknowledged producer:", response?.id);
                if (response?.id) {
                  producersRef.current.add(response.id);
                  producedTracksRef.current.add(params.kind);
                  callback({ id: response.id });
                } else {
                  callback({ id: `fallback-${params.kind}-${Date.now()}` });
                }
              });
            } catch (error) {
              console.error("❌ Produce error:", error);
              errback(error);
            }
          });

          transport.on("connectionstatechange", (state) => {
            console.log("🚦 Send transport state:", state);
            setTransportState(state);
            setIceConnectionState(state);

            if (state === "failed") {
              console.warn("❌ Transport failed, user can manually recover");
              runComprehensiveDiagnostics();
            } else if (state === "disconnected") {
              console.warn("⚠️ Transport disconnected");
              setTimeout(() => {
                if (sendTransportRef.current) {
                  recoverConnection();
                }
              }, 3000);
            }
            updateDebugInfo();
          });

          sendTransportRef.current = transport;
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      socketRef.current.once("createWebRtcTransportError", (error) => {
        clearTimeout(timeout);
        console.error("❌ Transport creation error:", error);
        reject(error);
      });
    });
  }

  async function createRecvTransport() {
    return new Promise((resolve, reject) => {
      console.log("🛠️ Creating receive transport...");

      if (!socketRef.current) {
        reject("Socket not available");
        return;
      }

      const timeout = setTimeout(() => {
        reject("Timeout creating receive transport");
      }, 10000);

      socketRef.current.off("createWebRtcTransportSuccess");
      socketRef.current.off("createWebRtcTransportError");

      socketRef.current.emit("createWebRtcTransport", {
        consumer: true,
        forceTcp: false,
      });

      socketRef.current.once("createWebRtcTransportSuccess", (data) => {
        clearTimeout(timeout);
        console.log("📦 Receive transport created:", data.id);

        if (!data || !deviceRef.current) {
          reject("No transport data or device not ready");
          return;
        }

        try {
          const transport = deviceRef.current.createRecvTransport({
            id: data.id,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            dtlsParameters: data.dtlsParameters,
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
              { urls: "stun:stun2.l.google.com:19302" },
            ],
          });

          transport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
              try {
                console.log("🔌 Connecting receive transport...");
                socketRef.current.emit("transport-connect", {
                  serverTransportId: data.id,
                  dtlsParameters,
                });

                const connectTimeout = setTimeout(() => {
                  console.log(
                    "✅ Receive transport connected (timeout fallback)"
                  );
                  callback();
                }, 1000);

                socketRef.current.once("transport-connected", () => {
                  clearTimeout(connectTimeout);
                  console.log(
                    "✅ Receive transport connected (server confirmed)"
                  );
                  callback();
                });
              } catch (error) {
                console.error("❌ Receive transport connect error:", error);
                errback(error);
              }
            }
          );

          transport.on("connectionstatechange", (state) => {
            console.log("🚦 Receive transport state:", state);
            updateDebugInfo();
          });

          recvTransportRef.current = transport;
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      socketRef.current.once("createWebRtcTransportError", (error) => {
        clearTimeout(timeout);
        console.error("❌ Receive transport creation error:", error);
        reject(error);
      });
    });
  }

  async function recoverConnection() {
    console.log("🔄 Attempting connection recovery...");

    // Close existing transports
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
    }

    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
    }

    producedTracksRef.current.clear();

    if (localStream) {
      try {
        console.log("🔄 Creating new transports...");

        // Add small delay to let network stabilize
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await createSendTransport();
        console.log("✅ Send transport recreated");

        await createRecvTransport();
        console.log("✅ Receive transport recreated");

        // Re-produce tracks with retry logic
        const videoTrack = localStream.getVideoTracks()[0];
        const audioTrack = localStream.getAudioTracks()[0];

        if (videoTrack && sendTransportRef.current) {
          try {
            await sendTransportRef.current.produce({
              track: videoTrack,
              appData: { mediaTag: "video" },
            });
            console.log("✅ Video track re-produced");
          } catch (error) {
            console.error("❌ Video re-production failed:", error);
          }
        }

        if (audioTrack && sendTransportRef.current) {
          try {
            await sendTransportRef.current.produce({
              track: audioTrack,
              appData: { mediaTag: "audio" },
            });
            console.log("✅ Audio track re-produced");
          } catch (error) {
            console.error("❌ Audio re-production failed:", error);
          }
        }

        console.log("✅ Connection recovery completed");
        setTransportState("connected");

        // Request producer list again after delay
        setTimeout(() => {
          if (socketRef.current?.connected) {
            console.log("📡 Re-requesting producer list...");
            socketRef.current.emit("getProducers");
          }
        }, 2000);
      } catch (error) {
        console.error("❌ Recovery failed:", error);
        setTimeout(() => {
          if (transportState === "failed") {
            console.log("🔄 Auto-attempting transport restart...");
            restartTransports();
          }
        }, 3000);
      }
    }
    updateDebugInfo();
  }

  async function restartTransports() {
    console.log("🔄 Restarting transports...");

    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
    }

    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
    }

    producedTracksRef.current.clear();
    consumingProducersRef.current.clear();
    consumersRef.current.clear();

    try {
      await createSendTransport();
      await createRecvTransport();
      console.log("✅ Transports restarted successfully");

      if (localStream && sendTransportRef.current) {
        const videoTrack = localStream.getVideoTracks()[0];
        const audioTrack = localStream.getAudioTracks()[0];

        if (videoTrack) {
          try {
            await sendTransportRef.current.produce({
              track: videoTrack,
              appData: { mediaTag: "video" },
            });
          } catch (error) {
            console.error("❌ Failed to re-produce video:", error);
          }
        }

        if (audioTrack) {
          try {
            await sendTransportRef.current.produce({
              track: audioTrack,
              appData: { mediaTag: "audio" },
            });
          } catch (error) {
            console.error("❌ Failed to re-produce audio:", error);
          }
        }
      }
    } catch (error) {
      console.error("❌ Failed to restart transports:", error);
    }
    updateDebugInfo();
  }

  async function startCamera() {
    if (!deviceRef.current || !socketRef.current?.connected) {
      console.warn("⏳ Device or socket not ready");
      alert("Please wait for connection to establish first");
      return;
    }

    try {
      console.log("📷 Starting camera...");

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        },
      });

      setLocalStream(stream);
      console.log("✅ Got user media");

      try {
        await createSendTransport();
        console.log("✅ Send transport ready");
      } catch (error) {
        console.error("❌ Send transport failed:", error);
        throw new Error("Failed to create send transport");
      }

      try {
        await createRecvTransport();
        console.log("✅ Receive transport ready");
      } catch (error) {
        console.error("❌ Receive transport failed:", error);
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (videoTrack && sendTransportRef.current) {
        try {
          const producer = await sendTransportRef.current.produce({
            track: videoTrack,
            appData: { mediaTag: "video" },
          });
          console.log("✅ Video track produced:", producer.id);
        } catch (error) {
          console.error("❌ Video production failed:", error);
        }
      }

      if (audioTrack && sendTransportRef.current) {
        try {
          const producer = await sendTransportRef.current.produce({
            track: audioTrack,
            appData: { mediaTag: "audio" },
          });
          console.log("✅ Audio track produced:", producer.id);
        } catch (error) {
          console.error("❌ Audio production failed:", error);
        }
      }

      setTimeout(() => {
        if (socketRef.current?.connected) {
          console.log("📡 Requesting producer list...");
          socketRef.current.emit("getProducers");
        }
      }, 2000);
    } catch (error) {
      console.error("❌ Error starting camera:", error);

      if (error instanceof Error) {
        if (error.name === "NotAllowedError") {
          alert(
            "Camera/microphone permission denied. Please allow access and try again."
          );
        } else if (error.name === "NotFoundError") {
          alert("No camera/microphone found. Please check your devices.");
        } else {
          alert(`Failed to start camera: ${error.message}`);
        }
      }

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        setLocalStream(null);
      }
    }
    updateDebugInfo();
  }

  async function consume(remoteProducerId) {
    if (!socketRef.current) {
      console.error("❌ Socket not available for consume");
      return;
    }

    if (consumingProducersRef.current.has(remoteProducerId)) {
      console.log("⏩ Already consuming from producer:", remoteProducerId);
      return;
    }

    console.log("🔍 Attempting to consume from producer:", remoteProducerId);

    if (!recvTransportRef.current) {
      console.log("🔄 Creating receive transport...");
      try {
        await createRecvTransport();
      } catch (error) {
        console.error("❌ Failed to create receive transport:", error);
        return;
      }
    }

    if (!deviceRef.current?.rtpCapabilities) {
      console.error("❌ Device capabilities not available");
      return;
    }

    console.log("📤 Sending consume request for producer:", remoteProducerId);

    socketRef.current.emit("consume", {
      rtpCapabilities: deviceRef.current.rtpCapabilities,
      remoteProducerId: remoteProducerId,
      serverConsumerTransportId: recvTransportRef.current?.id,
    });
  }

  function toggleMic() {
    const audio = localStream?.getAudioTracks()[0];
    if (audio) {
      audio.enabled = !audio.enabled;
      setIsMicOn(audio.enabled);
    }
  }

  function toggleCamera() {
    const video = localStream?.getVideoTracks()[0];
    if (video) {
      video.enabled = !video.enabled;
      setIsCamOn(video.enabled);
    }
  }

  function sendMessage() {
    if (!msg.trim() || !socketRef.current?.connected) return;

    const messageData = {
      roomName: ROOM_ID,
      user: "User",
      message: msg.trim(),
    };

    socketRef.current.emit("chatMessage", messageData);
    setMessages((prev) => [...prev, { ...messageData, user: "You" }]);
    setMsg("");
  }

  function leaveCall() {
    cleanup();
    setLocalStream(null);
    setRemoteStreams({});
    setJoined(false);
    setConnectionState("disconnected");
    setTransportState("disconnected");
    producersRef.current.clear();
    consumersRef.current.clear();
    producedTracksRef.current.clear();
    consumingProducersRef.current.clear();
  }

  function reconnect() {
    leaveCall();
    setTimeout(() => {
      initializeSocket();
    }, 1000);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col gap-6">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">🎥 Video Call</h1>
        <div className="flex items-center gap-4">
          <div
            className={`px-3 py-1 rounded text-sm ${
              connectionState === "connected"
                ? "bg-green-100 text-green-800"
                : connectionState === "connecting"
                ? "bg-yellow-100 text-yellow-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {connectionState === "connected"
              ? "🟢 Connected"
              : connectionState === "connecting"
              ? "🟡 Connecting"
              : "🔴 Disconnected"}
          </div>
          <div className="text-sm text-gray-500">Room: {ROOM_ID}</div>
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Video section */}
        <div className="col-span-2 bg-white rounded-xl p-4 shadow">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Local Video */}
            <div className="border rounded-lg overflow-hidden relative bg-black">
              <video
                ref={localVideoRef}
                className="w-full h-60 object-cover"
                muted
                autoPlay
                playsInline
              />
              <span className="absolute bottom-2 left-2 text-xs bg-black/50 text-white px-2 rounded">
                You {!localStream && "(Click Start Camera)"}
                {transportState === "failed" && " (Connection Failed)"}
              </span>
            </div>

            {/* Remote Videos */}
            <div className="space-y-3">
              {Object.keys(remoteStreams).length === 0 ? (
                <div className="flex items-center justify-center h-60 border rounded-lg bg-gray-100">
                  <div className="text-gray-500 text-center">
                    <div>No remote participants</div>
                    <div className="text-xs mt-1">
                      {producersRef.current.size > 0
                        ? "Connecting..."
                        : "Waiting for others to join..."}
                    </div>
                  </div>
                </div>
              ) : (
                Object.entries(remoteStreams).map(([producerId, stream]) => (
                  <div
                    key={producerId}
                    className="relative border rounded-lg overflow-hidden bg-black"
                  >
                    <video
                      className="w-full h-40 object-cover"
                      autoPlay
                      playsInline
                      ref={(el) => {
                        if (el && stream) el.srcObject = stream;
                      }}
                    />
                    <span className="absolute bottom-2 left-2 text-xs bg-black/50 text-white px-2 rounded">
                      Remote User
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="mt-4 flex flex-wrap gap-2">
            {!localStream ? (
              <div className="flex gap-2">
                <button
                  onClick={startCamera}
                  disabled={!joined || !socketRef.current?.connected}
                  className={`px-4 py-2 rounded text-white ${
                    joined && socketRef.current?.connected
                      ? "bg-indigo-600 hover:bg-indigo-500"
                      : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  {joined ? "Start Camera & Join" : "Connecting..."}
                </button>
                <button
                  onClick={reconnect}
                  className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-500"
                >
                  Refresh
                </button>
                <button
                  onClick={runComprehensiveDiagnostics}
                  className="px-3 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-500"
                >
                  🛠️ Run Diagnostics
                </button>
                <button
                  onClick={testNetworkConnectivity}
                  className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-500"
                >
                  🌐 Test Network
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={toggleMic}
                  className={`px-4 py-2 rounded ${
                    isMicOn
                      ? "bg-green-600 text-white"
                      : "bg-red-500 text-white"
                  }`}
                >
                  {isMicOn ? "🎤 Mic On" : "🎤 Mic Off"}
                </button>
                <button
                  onClick={toggleCamera}
                  className={`px-4 py-2 rounded ${
                    isCamOn
                      ? "bg-green-600 text-white"
                      : "bg-red-500 text-white"
                  }`}
                >
                  {isCamOn ? "📷 Cam On" : "📷 Cam Off"}
                </button>
                <button
                  onClick={recoverConnection}
                  className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-500"
                >
                  🔄 Recover
                </button>
                {transportState === "failed" && (
                  <button
                    onClick={restartTransports}
                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500"
                  >
                    🔁 Restart Transports
                  </button>
                )}
                <button
                  onClick={leaveCall}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500"
                >
                  Leave Call
                </button>
              </>
            )}
          </div>

          {/* Enhanced Debug info */}
          <div className="mt-4 p-3 bg-gray-100 rounded text-xs">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <div>
                Socket:{" "}
                <span
                  className={
                    connectionState === "connected"
                      ? "text-green-600"
                      : "text-red-600"
                  }
                >
                  {connectionState}
                </span>
              </div>
              <div>
                Transport:{" "}
                <span
                  className={
                    transportState === "connected"
                      ? "text-green-600"
                      : "text-red-600"
                  }
                >
                  {transportState}
                </span>
              </div>
              <div>
                ICE State:{" "}
                <span
                  className={
                    iceConnectionState === "connected"
                      ? "text-green-600"
                      : "text-red-600"
                  }
                >
                  {iceConnectionState || "unknown"}
                </span>
              </div>
              <div>
                Producers:{" "}
                <span className="font-mono">{producersRef.current.size}</span>
              </div>
              <div>
                Remote Streams:{" "}
                <span className="font-mono">
                  {Object.keys(remoteStreams).length}
                </span>
              </div>
              <div>
                Device:{" "}
                <span
                  className={
                    deviceRef.current ? "text-green-600" : "text-red-600"
                  }
                >
                  {deviceRef.current ? "✅" : "❌"}
                </span>
              </div>
              <div>
                Send Transport:{" "}
                <span
                  className={
                    sendTransportRef.current ? "text-green-600" : "text-red-600"
                  }
                >
                  {sendTransportRef.current ? "✅" : "❌"}
                </span>
              </div>
              <div>
                Recv Transport:{" "}
                <span
                  className={
                    recvTransportRef.current ? "text-green-600" : "text-red-600"
                  }
                >
                  {recvTransportRef.current ? "✅" : "❌"}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  console.log("Detailed Debug Info:", debugInfo);
                  alert("Check browser console for detailed debug info");
                }}
                className="px-2 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-400"
              >
                Log Debug Info
              </button>
              <button
                onClick={testWebRTCSupport}
                className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-500"
              >
                Test WebRTC
              </button>
              <button
                onClick={testMediaDevices}
                className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-500"
              >
                Test Media
              </button>
            </div>
          </div>
        </div>

        {/* Chat section */}
        <div className="bg-white rounded-xl p-4 shadow flex flex-col">
          <h2 className="font-semibold text-sm mb-2">💬 Chat</h2>
          <div className="flex-1 overflow-auto border rounded p-2 bg-gray-50 text-sm mb-2 max-h-60">
            {messages.length === 0 ? (
              <div className="text-gray-500 text-center py-4">
                No messages yet
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className="mb-2">
                  <span
                    className={`font-semibold ${
                      m.user === "You" ? "text-blue-600" : "text-gray-700"
                    }`}
                  >
                    {m.user}:
                  </span>
                  <span className="ml-1">{m.message}</span>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 border rounded px-3 py-2 text-sm"
              disabled={!socketRef.current?.connected}
            />
            <button
              onClick={sendMessage}
              disabled={!msg.trim() || !socketRef.current?.connected}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500 disabled:bg-gray-400"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {transportState === "failed" && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p className="font-semibold">WebRTC Connection Failed</p>
          <p className="text-sm mt-1">
            This is usually due to network restrictions. Try:
          </p>

          <div className="mt-2">
            <button
              onClick={runComprehensiveDiagnostics}
              className="px-3 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-500"
            >
              🛠️ Run Detailed Diagnostics Now
            </button>
          </div>
        </div>
      )}

      {connectionState === "error" && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p>
            Cannot join room - it may be full (max 2 participants). Try creating
            a new room.
          </p>
        </div>
      )}
    </div>
  );
}
