import React, { createContext, useContext, useState } from 'react';

export const VideoStreamContext = createContext();

export function VideoStreamProvider({ children }) {
    const [videoStreams, setVideoStreams] = useState(new Map());

    const updateStreamState = (streamPath, state) => {
        setVideoStreams(prev => {
            const newMap = new Map(prev);
            newMap.set(streamPath, state);
            return newMap;
        });
    };

    const getStreamState = (streamPath) => {
        return videoStreams.get(streamPath);
    };

    return (
        <VideoStreamContext.Provider value={{ videoStreams, updateStreamState, getStreamState }}>
            {children}
        </VideoStreamContext.Provider>
    );
}

export const useVideoStream = () => {
    const context = useContext(VideoStreamContext);
    if (!context) {
        throw new Error('useVideoStream must be used within a VideoStreamProvider');
    }
    return context;
};
