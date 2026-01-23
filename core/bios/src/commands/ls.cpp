#include "commands.hpp"
#include <emscripten/console.h>
#include <dirent.h>
#include <sys/stat.h>

namespace commands {
    CommandResult ls(const std::string& args) {
        const char* path = args.empty() ? "/" : args.c_str();

        DIR* dir = opendir(path);
        if (!dir) {
            std::string message = "Failed to open directory: ";
            message += path;
            return { -1, message };
        }

        struct dirent* entry;
        std::string output;
        while ((entry = readdir(dir)) != nullptr) {
            std::string full_path = std::string(path);
            if (full_path.back() != '/') {
                full_path += '/';
            }
            full_path += entry->d_name;

            struct stat st;
            if (stat(full_path.c_str(), &st) == 0) {
                std::string entry_type = S_ISDIR(st.st_mode) ? "d" : "-";
                output += entry_type + " " + entry->d_name + "\n";
            } else {
                output += entry->d_name;
                output += "\n";
            }
        }

        closedir(dir);
        return { 0, output };
    }
} 