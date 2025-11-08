import {useEffect, useState} from "react";
import {Trash2} from "lucide-react";

const defaultNames = [
  "Zach",
  "Elle",
  "Reece",
  "Ella",
  "Maggie",
  "Kim",
  "Bekah",
  "Jacob",
  "Dmitri",
  "Noah",
];

export default function App() {
  const [people, setPeople] = useState(undefined);
  const [newName, setNewName] = useState("");
  const [clicked, setClicked] = useState({});
  const [notes, setNotes] = useState({});
  const [networkUrl, setNetworkUrl] = useState("");

  // Get actual network IP
  useEffect(() => {
    fetch("/api/network-info")
      .then((res) => res.json())
      .then((data) => {
        const url = `http://${data.ip}:${data.port}`;
        setNetworkUrl(url);
      })
      .catch(() => {
        // Fallback to current URL if API fails
        setNetworkUrl(window.location.origin);
      });
  }, []);

  // Initialize from localStorage or defaults
  useEffect(() => {
    if (people === undefined) {
      const stored = localStorage.getItem("people-list");
      if (stored !== null && stored?.length > 2) {
        setPeople(JSON.parse(stored));
      } else {
        setPeople(defaultNames);
        localStorage.setItem("people-list", JSON.stringify(defaultNames));
      }
    }
  }, []);

  // Save changes to localStorage
  useEffect(() => {
    // Skip the initial render to avoid race condition
    const stored = localStorage.getItem("people-list");
    if (stored !== null && people !== undefined) {
      localStorage.setItem("people-list", JSON.stringify(people));
    }
  }, [people]);

  const handleAdd = () => {
    const name = newName.trim();
    if (name && !people.includes(name)) {
      setPeople([...people, name]);
      setNewName("");
    }
  };

  const handleRemove = (nameToRemove) => {
    // Remove from people array
    setPeople(people.filter((name) => name !== nameToRemove));

    // Clean up related state
    setClicked((prev) => {
      const newClicked = { ...prev };
      delete newClicked[nameToRemove];
      return newClicked;
    });

    setNotes((prev) => {
      const newNotes = { ...prev };
      delete newNotes[nameToRemove];
      return newNotes;
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-6">
      {/* Network URL in top right */}
      <div className="absolute top-4 right-4 bg-white px-3 py-2 rounded-md shadow-md hidden sm:block">
        <span className="text-xs text-gray-500">Network URL: </span>
        <span className="text-xs font-mono text-blue-600">{networkUrl}</span>
      </div>

      <div className="flex space-x-2 mb-8">
        <input
          type="text"
          placeholder="Add a name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handleAdd()}
          className="border rounded-md p-2 w-48"
        />
        <button
          onClick={handleAdd}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md"
        >
          Add
        </button>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 gap-6">
        {people?.map((name) => (
          <div key={name} className="flex flex-col items-center space-y-2">
            <button
              onClick={() =>
                setClicked((prev) => ({
                  ...prev,
                  [name]: !prev[name],
                }))
              }
              className={`w-24 h-24 rounded-lg shadow-md transition-colors duration-200 ${
                clicked[name] ? "bg-red-500" : "bg-green-500"
              }`}
            ></button>
            <div className="flex items-center gap-2">
              <div className="text-lg font-semibold">{name}</div>
              <button
                onClick={() => handleRemove(name)}
                className="text-red-500 hover:text-red-700 transition-colors"
                title={`Remove ${name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <textarea
        placeholder="Enter notes..."
        value={notes[name] || ""}
        onChange={(e) => {
          setNotes((prev) => ({
            ...prev,
            [name]: e.target.value,
          }));
          // Auto-resize textarea
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        onInput={(e) => {
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        className="border rounded-md p-2 max-w-[456px] w-[90%] text-sm resize-none overflow-hidden min-h-[32px]"
        rows="1"
      />
    </div>
  );
}
