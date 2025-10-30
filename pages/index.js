"use client";

import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import { Device } from "mediasoup-client";

export default function VideoCallPage() {
  const WS_URL = `ws://${process.env.NEXT_PUBLIC_BASE_URL}/mediasoup`;
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

  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const producersRef = useRef(new Set());
  const consumersRef = useRef(new Set());
  const producedTracksRef = useRef(new Set());
  const consumingProducersRef = useRef(new Set());
  const localVideoRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    initializeSocket();

    return () => {
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

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
    });

    s.on("disconnect", (reason) => {
      console.warn("⚠️ Disconnected:", reason);
      setConnectionState("disconnected");
      setTransportState("disconnected");
    });

    s.on("connect_error", (error) => {
      console.error("❌ Connection error:", error);
      setConnectionState("error");
    });

    // EVENT: joinedRoom - Joined existing room
    s.on("joinedRoom", (res) => {
      console.log("🎉 Joined room:", res);
      const rtpCaps = res?.rtpCapabilities;
      if (!rtpCaps) {
        console.error("❌ No rtpCapabilities found");
        return;
      }
      loadDevice(rtpCaps);
      setJoined(true);
    });

    // EVENT: producerList - List of active producers in room
    s.on("producerList", (list) => {
      console.log("📋 Producer list received:", list);
      if (list && list.length > 0) {
        list.forEach((producerId) => {
          if (producerId && !producersRef.current.has(producerId)) {
            console.log("👀 Found existing producer:", producerId);
            producersRef.current.add(producerId);
            consume(producerId);
          }
        });
      } else {
        console.log("📭 No producers in room yet");
      }
    });

    s.on("newProducer", (producerId) => {
      console.log("🆕 New producer event:", producerId);
      if (producerId && !producersRef.current.has(producerId)) {
        producersRef.current.add(producerId);
        consume(producerId);
      }
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
    });

    // EVENT: consumed - Consumer successfully created
    s.on("consumed", async (data) => {
      console.log("🎥 Consumed event received:", data);
      if (!data) {
        console.error("❌ No consume data received");
        return;
      }

      const { id, kind, rtpParameters, producerId } = data;

      if (consumingProducersRef.current.has(producerId)) {
        console.log("⏩ Already consuming from producer:", producerId);
        return;
      }

      try {
        console.log("🔄 Creating consumer for:", kind, "producer:", producerId);

        if (!recvTransportRef.current) {
          console.error("❌ Receive transport not ready");
          return;
        }

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

        // EVENT: consumer-resumed - Server will resume consumer for us
        // We don't call consumer.resume() here - server handles it
      } catch (error) {
        console.error("❌ Error creating consumer:", error);
        consumingProducersRef.current.delete(producerId);
      }
    });

    // EVENT: consumer-resumed - Consumer resumed (playback)
    s.on("consumer-resumed", (data) => {
      console.log("▶️ Consumer resumed by server:", data);
      // Remote stream should now be playing automatically
    });

    s.on("chatMessage", (message) => {
      console.log("💬 Chat message:", message);
      if (message) {
        setMessages((prev) => [...prev, message]);
      }
    });

    // EVENT: error - Server-side error
    s.on("error", (error) => {
      console.error("❌ Socket error:", error);
      if (error?.message?.includes("room is full")) {
        alert("Room is full (max 2 participants). Please try another room.");
      }
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
    } catch (e) {
      console.error("❌ Device load error:", e);
    }
  }

  async function createSendTransport() {
    return new Promise((resolve, reject) => {
      console.log("🛠️ Creating send transport...");

      if (!socketRef.current) {
        reject("Socket not available");
        return;
      }

      socketRef.current.emit("createWebRtcTransport", {
        consumer: false,
        forceTcp: false,
      });

      // EVENT: createWebRtcTransportSuccess - WebRTC transport parameters from server
      socketRef.current.once("createWebRtcTransportSuccess", (data) => {
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
            // iceServers : [
            //   {

            //   }
            // ]
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

                // EVENT: transport-connected - DTLS handshake success
                socketRef.current.once("transport-connected", () => {
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

              // EVENT: produced - Producer successfully created
              socketRef.current.once("produced", (response) => {
                console.log("✅ Server acknowledged producer:", response?.id);
                if (response?.id) {
                  producersRef.current.add(response.id);
                  producedTracksRef.current.add(params.kind);
                  callback({ id: response.id });
                } else {
                  errback(
                    new Error("Server production failed - no producer ID")
                  );
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
          });

          sendTransportRef.current = transport;
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      socketRef.current.once("createWebRtcTransportError", (error) => {
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

      socketRef.current.emit("createWebRtcTransport", {
        consumer: true,
        forceTcp: false,
      });

      // EVENT: createWebRtcTransportSuccess - WebRTC transport parameters from server
      socketRef.current.once("createWebRtcTransportSuccess", (data) => {
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

                // EVENT: transport-connected - DTLS handshake success
                socketRef.current.once("transport-connected", () => {
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
          });

          recvTransportRef.current = transport;
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      socketRef.current.once("createWebRtcTransportError", (error) => {
        console.error("❌ Receive transport creation error:", error);
        reject(error);
      });
    });
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

      await createSendTransport();
      console.log("✅ Send transport ready");

      await createRecvTransport();
      console.log("✅ Receive transport ready");

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (videoTrack && sendTransportRef.current) {
        await sendTransportRef.current.produce({
          track: videoTrack,
          appData: { mediaTag: "video" },
        });
        console.log("✅ Video track produced");
      }

      if (audioTrack && sendTransportRef.current) {
        await sendTransportRef.current.produce({
          track: audioTrack,
          appData: { mediaTag: "audio" },
        });
        console.log("✅ Audio track produced");
      }

      // Request producer list to consume existing streams
      console.log("📡 Requesting producer list...");
      socketRef.current.emit("getProducers");
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
        <div className="col-span-2 bg-white rounded-xl p-4 shadow">
          <div className="grid md:grid-cols-2 gap-4">
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
                  onClick={leaveCall}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500"
                >
                  Leave Call
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow flex flex-col text-black">
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
    </div>
  );
}
