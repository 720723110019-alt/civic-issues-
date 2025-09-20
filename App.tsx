import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Chat } from "@google/genai";
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// --- LEAFLET MARKER FIX ---
// This boilerplate is needed to fix an issue where marker icons don't appear
// when using bundlers like Vite or Webpack.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});


// --- TYPES ---
type Role = 'User' | 'Admin';
type IssueStatus = 'Pending' | 'In Progress' | 'Resolved';
type MediaType = 'photo' | 'video';
type Media = { type: MediaType; data: string };
type Issue = {
  id: string;
  category: string;
  description: string;
  location: { lat: number; lng: number } | null;
  media: Media;
  status: IssueStatus;
  reportedBy: string;
};
type User = { name: string; role: Role };
type ChatMessage = {
  role: 'user' | 'model';
  text: string;
};


// --- MOCK DATA & CONSTANTS ---
const initialIssues: Issue[] = [
  {
    id: '1', category: 'Pothole', description: 'Large pothole on the main street near the library.',
    location: { lat: 34.0522, lng: -118.2437 },
    media: { type: 'photo', data: 'https://via.placeholder.com/400x300.png?text=Pothole+Image' },
    status: 'Pending', reportedBy: 'User'
  },
  {
    id: '2', category: 'Garbage', description: 'Overflowing trash can at the park entrance.',
    location: { lat: 34.055, lng: -118.25 },
    media: { type: 'photo', data: 'https://via.placeholder.com/400x300.png?text=Garbage+Image' },
    status: 'In Progress', reportedBy: 'User'
  },
];

const ISSUE_CATEGORIES = ['Pothole', 'Garbage', 'Streetlight', 'Damaged Sign', 'Graffiti', 'Other'];

// --- GEMINI SERVICE ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const classifyIssueWithGemini = async (media: Media): Promise<string> => {
  try {
    const [header, base64Data] = media.data.split(',');
    if (!base64Data) {
      throw new Error("Invalid media data format");
    }

    const mimeType = header.match(/:(.*?);/)?.[1];
    if (!mimeType) {
      throw new Error("Could not determine MIME type from data URL");
    }

    const mediaPart = {
      inlineData: { mimeType, data: base64Data },
    };
    
    const textPart = {
      text: `Analyze this ${media.type} of a civic issue. Classify it into one of the following categories: ${ISSUE_CATEGORIES.join(', ')}. Respond with only the category name.`
    };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [mediaPart, textPart] },
    });

    const category = response.text.trim();
    return ISSUE_CATEGORIES.includes(category) ? category : 'Other';
  } catch (error) {
    console.error("Gemini API error:", error);
    return 'Other'; // Fallback category
  }
};


// --- HELPER COMPONENTS ---
const Spinner: React.FC = () => (
  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

const Chatbot: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chatSession = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: 'You are a friendly and helpful chatbot for the "Civic Issue Reporter" app. Your goal is to assist users with their questions. Answer concisely about how to report issues, check the status of their reports, and use the platform. If asked about something outside of this scope, politely state that you can only help with app-related questions.',
        },
    });
    setChat(chatSession);
    setMessages([{ role: 'model', text: "Hello! How can I help you with the Civic Issue Reporter app today?" }]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isLoading || !chat) return;

    const userMessage: ChatMessage = { role: 'user', text: userInput };
    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setIsLoading(true);

    try {
      const response = await chat.sendMessage({ message: userInput });
      const modelMessage: ChatMessage = { role: 'model', text: response.text };
      setMessages(prev => [...prev, modelMessage]);
    } catch (error) {
      console.error("Chatbot error:", error);
      const errorMessage: ChatMessage = { role: 'model', text: "Sorry, I'm having trouble connecting right now. Please try again later." };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-20 right-4 w-80 h-96 bg-white rounded-lg shadow-2xl flex flex-col z-50">
      <header className="bg-blue-600 text-white p-3 flex justify-between items-center rounded-t-lg">
        <h3 className="font-bold text-lg">AI Assistant</h3>
        <button onClick={onClose} className="text-xl font-bold">&times;</button>
      </header>
      <div className="flex-grow p-4 overflow-y-auto bg-gray-50">
        {messages.map((msg, index) => (
          <div key={index} className={`flex mb-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`rounded-lg px-3 py-2 max-w-xs ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
              {msg.text}
            </div>
          </div>
        ))}
         {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 bg-gray-200 text-gray-800">
              <div className="flex items-center">
                <span className="animate-pulse mr-1">.</span>
                <span className="animate-pulse delay-75 mr-1">.</span>
                <span className="animate-pulse delay-150">.</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSendMessage} className="p-2 border-t flex">
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Ask a question..."
          className="flex-grow p-2 border rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button type="submit" className="bg-blue-600 text-white px-4 rounded-r-md hover:bg-blue-700 disabled:bg-blue-300" disabled={isLoading}>
          Send
        </button>
      </form>
    </div>
  );
};


// --- MAIN COMPONENTS ---

const AuthPage: React.FC<{ onLogin: (user: User) => void }> = ({ onLogin }) => (
  <div className="flex items-center justify-center min-h-screen bg-gray-100">
    <div className="p-8 bg-white rounded-lg shadow-xl text-center w-full max-w-sm">
      <h1 className="text-3xl font-bold text-gray-800 mb-2">Civic Issue Reporter</h1>
      <p className="text-gray-600 mb-8">Login to report issues or manage reports.</p>
      <div className="space-y-4">
        <button onClick={() => onLogin({ name: 'User', role: 'User' })} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300">Login as User</button>
        <button onClick={() => onLogin({ name: 'Admin', role: 'Admin' })} className="w-full bg-gray-700 hover:bg-gray-800 text-white font-bold py-3 px-4 rounded-lg transition duration-300">Login as Admin</button>
      </div>
    </div>
  </div>
);

const ReportIssue: React.FC<{ onSubmit: (issue: Omit<Issue, 'id' | 'status' | 'category'> & { category?: string }) => void; onBack: () => void; }> = ({ onSubmit, onBack }) => {
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);


  const startCamera = async () => {
    try {
      setError('');
      setMedia(null);
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch (err) {
      setError('Camera access denied. Please enable camera permissions in your browser.');
      console.error(err);
    }
  };

  const stopCamera = () => {
    stream?.getTracks().forEach(track => track.stop());
    setStream(null);
  }

  const takePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg');
      setMedia({ type: 'photo', data: dataUrl });
      stopCamera();
    }
  };

  const startRecording = () => {
    if (stream) {
      mediaRecorderRef.current = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mediaRecorderRef.current.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0].type });
        const reader = new FileReader();
        reader.onload = () => {
          setMedia({ type: 'video', data: reader.result as string });
          stopCamera();
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const getLocation = () => {
    setIsLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setIsLoading(false);
      },
      () => {
        setError('Unable to retrieve location. Please enable location services.');
        setIsLoading(false);
      }
    );
  };
  
  const handleSubmit = async () => {
    if (!media || !description || !location) {
        setError('Please capture media, add a description, and get your location.');
        return;
    }
    setError('');
    setIsClassifying(true);
    const category = await classifyIssueWithGemini(media);
    onSubmit({ description, location, media, reportedBy: 'User', category });
    setIsClassifying(false);
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4 max-w-2xl mx-auto">
        <button onClick={onBack} className="text-blue-600 hover:underline mb-4">&larr; Back to Dashboard</button>
        <div className="bg-white p-6 rounded-lg shadow-lg space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Report New Issue</h2>
            
            {/* Media Capture */}
            <div className="space-y-2">
                <label className="font-semibold text-gray-700">1. Capture Media</label>
                <div className="w-full bg-gray-900 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
                    {media ? (
                      media.type === 'photo' ? (
                        <img src={media.data} alt="Captured issue" className="w-full h-full object-cover"/>
                      ) : (
                        <video src={media.data} controls className="w-full h-full object-cover"></video>
                      )
                    ) : stream ? (
                      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover">
                        {isRecording && <div className="absolute top-2 left-2 w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>}
                      </video>
                    ) : (
                      <div className="text-gray-400">Camera is off</div>
                    )}
                </div>
                 <div className="flex gap-2">
                    {media ? (
                        <button onClick={startCamera} className="flex-1 bg-yellow-500 text-white py-2 px-4 rounded-lg hover:bg-yellow-600">Retake</button>
                    ) : stream ? (
                        <>
                            <button onClick={takePhoto} disabled={isRecording} className="flex-1 bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 disabled:bg-gray-400">Take Photo</button>
                            {isRecording ? (
                                <button onClick={stopRecording} className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 flex items-center justify-center">
                                  <span className="w-3 h-3 bg-white rounded-sm mr-2"></span>Stop Recording
                                </button>
                            ) : (
                                <button onClick={startRecording} className="flex-1 bg-red-500 text-white py-2 px-4 rounded-lg hover:bg-red-600 flex items-center justify-center">
                                  <span className="w-3 h-3 bg-white rounded-full mr-2"></span>Record Video
                                </button>
                            )}
                        </>
                    ) : (
                        <button onClick={startCamera} className="flex-1 bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600">Start Camera</button>
                    )}
                </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
                <label htmlFor="description" className="font-semibold text-gray-700">2. Description</label>
                <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue..." className="w-full p-2 border border-gray-300 rounded-lg" rows={3}></textarea>
            </div>

            {/* Location */}
            <div className="space-y-2">
                <label className="font-semibold text-gray-700">3. Location</label>
                {location ? (
                    <p className="p-2 bg-gray-100 rounded-lg text-sm">{`Lat: ${location.lat.toFixed(4)}, Lng: ${location.lng.toFixed(4)}`}</p>
                ) : (
                    <button onClick={getLocation} disabled={isLoading} className="w-full flex items-center justify-center bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300 disabled:opacity-50">
                        {isLoading && <Spinner/>} Get Current Location
                    </button>
                )}
            </div>
             
            {error && <p className="text-red-500 text-sm">{error}</p>}
            
            <button onClick={handleSubmit} disabled={isClassifying || !media || !description || !location} className="w-full flex items-center justify-center bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition duration-300 disabled:bg-blue-300">
                {isClassifying ? <><Spinner/> Classifying & Submitting...</> : 'Submit Report'}
            </button>
        </div>
    </div>
  );
};

const MapComponent: React.FC<{
  issues: Issue[];
  onUpdateStatus: (id: string, status: IssueStatus) => void;
}> = ({ issues, onUpdateStatus }) => {
  const defaultCenter: L.LatLngExpression = [34.0522, -118.2437]; // Default to LA

  const issuesWithLocation = issues.filter(issue => issue.location);

  const mapCenter = issuesWithLocation.length > 0 
    ? [issuesWithLocation[0].location!.lat, issuesWithLocation[0].location!.lng] as L.LatLngExpression 
    : defaultCenter;

  return (
    <MapContainer center={mapCenter} zoom={12} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {issuesWithLocation.map(issue => (
        <Marker key={issue.id} position={[issue.location!.lat, issue.location!.lng]}>
          <Popup>
            <div className="w-64 space-y-2">
              <img src={issue.media.data} alt={issue.category} className="w-full h-32 object-cover rounded-md"/>
              <h3 className="text-md font-bold text-gray-900">{issue.category}</h3>
              <p className="text-gray-600 text-sm">{issue.description}</p>
              <p className="text-xs text-gray-500">{`Status: ${issue.status}`}</p>
              <div className="pt-2 border-t">
                <label className="text-xs font-semibold text-gray-500">Update Status:</label>
                <select
                  value={issue.status}
                  onChange={(e) => onUpdateStatus(issue.id, e.target.value as IssueStatus)}
                  className="w-full mt-1 p-1 border border-gray-300 rounded-lg text-sm"
                  onClick={(e) => e.stopPropagation()} // Prevent map click events
                >
                  <option>Pending</option>
                  <option>In Progress</option>
                  <option>Resolved</option>
                </select>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};


const Dashboard: React.FC<{
  user: User;
  issues: Issue[];
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onUpdateStatus?: (id: string, status: IssueStatus) => void;
}> = ({ user, issues, onLogout, onNavigate, onUpdateStatus }) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
    
  const getStatusColor = (status: IssueStatus) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-100 text-yellow-800';
      case 'In Progress': return 'bg-blue-100 text-blue-800';
      case 'Resolved': return 'bg-green-100 text-green-800';
    }
  };

  const userIssues = user.role === 'User' ? issues.filter(i => i.reportedBy === user.name) : issues;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-white shadow-md">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">{user.role} Dashboard</h1>
          <button onClick={onLogout} className="text-sm font-medium text-red-600 hover:underline">Logout</button>
        </div>
      </header>
      
      {/* Admin View with Map */}
      {user.role === 'Admin' && onUpdateStatus ? (
        <main className="container mx-auto p-4 flex-grow grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-lg overflow-hidden h-[50vh] lg:h-full">
            <MapComponent issues={issues} onUpdateStatus={onUpdateStatus} />
          </div>
          <div className="overflow-y-auto space-y-4 h-[50vh] lg:h-full pr-2">
            <h2 className="text-xl font-semibold text-gray-700">All Reported Issues</h2>
            {issues.length === 0 ? (
                <p className="text-center text-gray-500 mt-8">No issues reported yet.</p>
            ) : (
                issues.map(issue => (
                    <div key={issue.id} className="bg-white rounded-lg shadow-lg overflow-hidden">
                      <img src={issue.media.data} alt={issue.category} className="w-full h-48 object-cover"/>
                      <div className="p-4">
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="text-lg font-bold text-gray-900">{issue.category}</h3>
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${getStatusColor(issue.status)}`}>{issue.status}</span>
                        </div>
                        <p className="text-gray-600 text-sm mb-3">{issue.description}</p>
                        {issue.location && <p className="text-xs text-gray-500">{`Location: ${issue.location.lat.toFixed(4)}, ${issue.location.lng.toFixed(4)}`}</p>}
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <label className="text-xs font-semibold text-gray-500">Update Status:</label>
                          <select value={issue.status} onChange={(e) => onUpdateStatus(issue.id, e.target.value as IssueStatus)} className="w-full mt-1 p-2 border border-gray-300 rounded-lg text-sm">
                            <option>Pending</option>
                            <option>In Progress</option>
                            <option>Resolved</option>
                          </select>
                        </div>
                      </div>
                    </div>
                ))
            )}
          </div>
        </main>
      ) : (
      
      /* User View */
      <>
        <main className="container mx-auto p-4 flex-grow">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-700">My Reported Issues</h2>
            {onNavigate && (
              <button onClick={() => onNavigate('report')} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Report New Issue</button>
            )}
          </div>
          
          {userIssues.length === 0 ? (
              <p className="text-center text-gray-500 mt-8">No issues reported yet.</p>
          ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {userIssues.map(issue => (
                  <div key={issue.id} className="bg-white rounded-lg shadow-lg overflow-hidden">
                  <img src={issue.media.data} alt={issue.category} className="w-full h-48 object-cover"/>
                  <div className="p-4">
                      <div className="flex justify-between items-start mb-2">
                          <h3 className="text-lg font-bold text-gray-900">{issue.category}</h3>
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${getStatusColor(issue.status)}`}>{issue.status}</span>
                      </div>
                      <p className="text-gray-600 text-sm mb-3">{issue.description}</p>
                      {issue.location && <p className="text-xs text-gray-500">{`Location: ${issue.location.lat.toFixed(4)}, ${issue.location.lng.toFixed(4)}`}</p>}
                  </div>
                  </div>
              ))}
              </div>
          )}
        </main>
        {isChatOpen && <Chatbot onClose={() => setIsChatOpen(false)} />}
        <button 
          onClick={() => setIsChatOpen(true)} 
          className="fixed bottom-4 right-4 bg-blue-600 text-white rounded-full p-4 shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 z-40"
          aria-label="Open chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      </>
      )}
    </div>
  );
};


// --- APP ---
const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [page, setPage] = useState('dashboard'); // for user navigation

  const handleLogin = (loggedInUser: User) => setUser(loggedInUser);
  const handleLogout = () => setUser(null);

  const handleAddIssue = (newIssueData: Omit<Issue, 'id' | 'status'>) => {
    const newIssue: Issue = {
      ...newIssueData,
      id: new Date().toISOString(),
      status: 'Pending',
      category: newIssueData.category || 'Other',
    };
    setIssues(prev => [newIssue, ...prev]);
    setPage('dashboard');
  };

  const handleUpdateStatus = (id: string, status: IssueStatus) => {
    setIssues(prev => prev.map(issue => issue.id === id ? { ...issue, status } : issue));
  };
  
  if (!user) {
    return <AuthPage onLogin={handleLogin} />;
  }
  
  if (user.role === 'Admin') {
      return <Dashboard user={user} issues={issues} onLogout={handleLogout} onUpdateStatus={handleUpdateStatus}/>
  }
  
  // User View
  if (page === 'report') {
    return <ReportIssue onSubmit={handleAddIssue} onBack={() => setPage('dashboard')} />;
  }

  return <Dashboard user={user} issues={issues} onLogout={handleLogout} onNavigate={setPage} />;
};

export default App;
